#!/usr/bin/env node

import { Command } from "commander";
import { randomUUID } from "crypto";
import { readdirSync, statSync } from "fs";
import { join, basename, extname } from "path";
import pLimit from "p-limit";
import { loadConfig } from "../config";
import { createDatabase, createEmbeddingModel } from "../factories";
import { createPDFParser } from "../parsers/pdf-parser";
import { chunkPDFText } from "../utils/chunking";
import { pdfDocuments, pdfChunks } from "../db/schema";
import { getRawDb, DrizzleDB } from "../db/client";
import { EmbeddingModel } from "../core/types";

const program = new Command();

type DocumentType = "slides" | "paper" | "exercises" | "other";

/**
 * Recursively find all PDF files in a directory
 */
function findPDFs(dir: string): string[] {
  const results: string[] = [];

  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      results.push(...findPDFs(fullPath));
    } else if (stat.isFile() && extname(entry).toLowerCase() === ".pdf") {
      results.push(fullPath);
    }
  }

  return results;
}

/**
 * Get filepaths of already ingested PDFs from database
 */
function getAlreadyIngestedPaths(db: DrizzleDB): Set<string> {
  const existing = db.select({ filepath: pdfDocuments.filepath }).from(pdfDocuments).all();
  return new Set(existing.map(e => e.filepath));
}

/**
 * Auto-detect document type from filename/path
 */
function detectDocumentType(filepath: string): DocumentType {
  const lower = filepath.toLowerCase();

  if (lower.includes("exercise") || lower.includes("midterm") ||
      lower.includes("final") || lower.includes("exam")) {
    return "exercises";
  }
  if (lower.includes("solution")) {
    return "other";
  }
  if (lower.includes("paper") || lower.includes("article")) {
    return "paper";
  }
  // Default to slides for lecture materials
  return "slides";
}

/**
 * Ingest a single PDF file
 */
async function ingestSinglePDF(
  filepath: string,
  db: DrizzleDB,
  embedder: EmbeddingModel | null,
  options: { type?: string; title?: string; quiet?: boolean }
): Promise<string> {
  const parser = createPDFParser();

  if (!options.quiet) {
    console.log(`Parsing: ${basename(filepath)}...`);
  }

  const parsed = await parser.parse(filepath);

  if (!options.quiet) {
    console.log(`  Pages: ${parsed.pageCount}, Chars: ${parsed.text.length.toLocaleString()}`);
  }

  const pdfId = randomUUID();
  const now = new Date();
  const docType = (options.type || detectDocumentType(filepath)) as DocumentType;

  await db.insert(pdfDocuments).values({
    id: pdfId,
    filename: parsed.filename,
    filepath: filepath,
    title: options.title || parsed.title || parsed.filename,
    pageCount: parsed.pageCount,
    charCount: parsed.text.length,
    documentType: docType,
    metadata: parsed.metadata,
    createdAt: now,
    updatedAt: now,
  });

  const chunks = chunkPDFText(parsed.pages, 3000);

  let embeddings: Float32Array[] | null = null;
  if (embedder) {
    const chunkTexts = chunks.map((c) => c.text);
    embeddings = await embedder.embedBatch(chunkTexts);
  }

  for (let i = 0; i < chunks.length; i++) {
    await db.insert(pdfChunks).values({
      pdfId,
      chunkIndex: chunks[i].index,
      pageNumber: chunks[i].pageNumber,
      text: chunks[i].text,
      charCount: chunks[i].charCount,
      embedding: embeddings ? Buffer.from(embeddings[i].buffer) : null,
    });
  }

  if (!options.quiet) {
    console.log(`  ✓ Ingested: ${pdfId} (${chunks.length} chunks, type: ${docType})`);
  }

  return pdfId;
}

program
  .name("ingest-pdf")
  .description("Parse and store PDF file(s) for topic extraction. Accepts a single file or a directory (recursive).")
  .argument("<path>", "Path to PDF file or directory containing PDFs")
  .option(
    "-t, --type <type>",
    "Document type (slides, paper, exercises, other). Auto-detected if not specified."
  )
  .option("-T, --title <title>", "Override document title (single file only)")
  .option("-c, --config <path>", "Path to config file", "./config.json")
  .option("--no-embed", "Skip embedding generation (faster, for testing)")
  .option("-r, --recursive", "Process directory recursively (default for directories)")
  .option("--dry-run", "List PDFs that would be processed without ingesting")
  .option("--concurrency <n>", "Number of PDFs to process in parallel", "5")
  .option("--force", "Re-ingest PDFs even if already in database")
  .action(
    async (
      path: string,
      options: {
        type?: string;
        title?: string;
        config: string;
        embed: boolean;
        recursive?: boolean;
        dryRun?: boolean;
        concurrency: string;
        force?: boolean;
      }
    ) => {
      try {
        const config = loadConfig(options.config);
        const db = createDatabase(config.db.path);
        const concurrency = parseInt(options.concurrency, 10) || 5;

        // Check if path is file or directory
        const stat = statSync(path);
        const isDirectory = stat.isDirectory();

        // Get list of PDFs to process
        let allPdfFiles = isDirectory ? findPDFs(path) : [path];

        if (allPdfFiles.length === 0) {
          console.log("No PDF files found.");
          getRawDb(db).close();
          process.exit(0);
        }

        // Filter out already ingested PDFs (unless --force)
        let pdfFiles = allPdfFiles;
        let skippedCount = 0;

        if (!options.force) {
          const alreadyIngested = getAlreadyIngestedPaths(db);
          pdfFiles = allPdfFiles.filter(f => !alreadyIngested.has(f));
          skippedCount = allPdfFiles.length - pdfFiles.length;
        }

        console.log(`Found ${allPdfFiles.length} PDF(s)`);
        if (skippedCount > 0) {
          console.log(`  Skipping ${skippedCount} already ingested (use --force to re-ingest)`);
        }
        console.log(`  Processing ${pdfFiles.length} new PDF(s) with concurrency=${concurrency}\n`);

        if (pdfFiles.length === 0) {
          console.log("Nothing to process.");
          getRawDb(db).close();
          process.exit(0);
        }

        if (options.dryRun) {
          console.log("DRY RUN - Files that would be processed:\n");
          for (const file of pdfFiles) {
            const docType = options.type || detectDocumentType(file);
            console.log(`  [${docType}] ${file}`);
          }
          getRawDb(db).close();
          process.exit(0);
        }

        // Create embedder if needed
        const embedder = options.embed ? createEmbeddingModel(config) : null;

        // Process PDFs in parallel with p-limit
        const limit = pLimit(concurrency);
        const results: { file: string; id: string; error?: string }[] = [];
        let completed = 0;

        const tasks = pdfFiles.map((file) =>
          limit(async () => {
            completed++;
            const progress = `[${completed}/${pdfFiles.length}]`;
            console.log(`${progress} ${basename(file)}`);

            try {
              const id = await ingestSinglePDF(file, db, embedder, {
                type: options.type,
                title: isDirectory ? undefined : options.title,
                quiet: true,
              });
              console.log(`  ✓ ${id}`);
              return { file, id };
            } catch (error) {
              const errorMsg = (error as Error).message;
              console.log(`  ✗ Error: ${errorMsg}`);
              return { file, id: "", error: errorMsg };
            }
          })
        );

        const taskResults = await Promise.all(tasks);
        results.push(...taskResults);

        // Summary
        const successful = results.filter((r) => !r.error);
        const failed = results.filter((r) => r.error);

        console.log(`\n${"=".repeat(50)}`);
        console.log(`✓ Complete: ${successful.length} ingested, ${failed.length} failed`);
        if (skippedCount > 0) {
          console.log(`  (${skippedCount} skipped - already in database)`);
        }

        if (successful.length > 0) {
          console.log(`\nTo extract topics from all ingested PDFs:`);
          for (const r of successful.slice(0, 3)) {
            console.log(`  yarn extract-topics ${r.id}`);
          }
          if (successful.length > 3) {
            console.log(`  ... and ${successful.length - 3} more`);
          }
        }

        getRawDb(db).close();
        process.exit(failed.length > 0 ? 1 : 0);
      } catch (error) {
        console.error(`\n❌ Ingestion failed: ${(error as Error).message}`);
        process.exit(1);
      }
    }
  );

program.parse();
