#!/usr/bin/env node

import { Command } from "commander";
import { LangfuseClient } from "@langfuse/client";
import { loadConfig } from "../config";
import { createTopicExtractor, createDatabase } from "../factories";
import { getLangfusePrompt } from "../prompts/get-langfuse-prompt";
import { getRawDb } from "../db/client";

const program = new Command();

// Default prompt if not in Langfuse yet
const DEFAULT_PROMPT = `Extract the main topics from this document. For each topic:
- Title: Concise, descriptive name (max 100 chars)
- Summary: 1-2 sentences explaining what this topic covers
- Key Points: 3-5 bullet points of important information
- Source Text: The actual relevant content from the document that covers this topic.
  Include formulas, definitions, theorems, proofs, and explanations.
  This should be verbatim or near-verbatim text that a student would read to understand the topic.
  NOT just headings or outlines - include the actual educational content.

Guidelines by document type:
- For lecture slides: Focus on concepts taught, not administrative content. Include formulas and definitions.
- For papers: Focus on methodology, findings, contributions. Include key equations and results.
- For exercises: Focus on problem statements and solution approaches.

Return 3-8 topics depending on document length. Include subtopics if there are naturally nested concepts.

If the document has no substantial topics (e.g., table of contents only), return an empty array.`;

program
  .name("extract-topics")
  .description("Extract topics from a stored PDF document using LLM")
  .argument("<pdf-id>", "UUID of the PDF document")
  .option("-c, --config <path>", "Path to config file", "./config.json")
  .option(
    "-p, --prompt <name>",
    "Langfuse prompt name (uses default if not found)",
    "topic_extraction"
  )
  .option("--use-default-prompt", "Skip Langfuse, use built-in default prompt")
  .option("--overwrite", "Delete existing topics and re-extract")
  .action(
    async (
      pdfId: string,
      options: {
        config: string;
        prompt: string;
        useDefaultPrompt?: boolean;
        overwrite?: boolean;
      }
    ) => {
      const langfuse = new LangfuseClient();

      try {
        const config = loadConfig(options.config);
        const db = createDatabase(config.db.path);

        // Get prompt template
        let promptTemplate: string;

        if (options.useDefaultPrompt) {
          console.log("Using default prompt template\n");
          promptTemplate = DEFAULT_PROMPT;
        } else {
          try {
            console.log(`Fetching prompt "${options.prompt}" from Langfuse...`);
            promptTemplate = await getLangfusePrompt(langfuse, options.prompt);
            console.log("Prompt loaded from Langfuse\n");
          } catch {
            console.log(
              `Prompt "${options.prompt}" not found in Langfuse, using default\n`
            );
            promptTemplate = DEFAULT_PROMPT;
          }
        }

        const extractor = createTopicExtractor(config, db, promptTemplate);

        if (options.overwrite) {
          console.log("Overwrite mode: will delete existing topics and re-extract\n");
        }

        console.log(`Extracting topics from PDF: ${pdfId}...`);
        const topics = await extractor.extractFromPDF(pdfId, {
          overwrite: options.overwrite,
        });

        // Check if topics were returned from cache (already existed)
        const wasSkipped = !options.overwrite && topics.length > 0;
        if (wasSkipped) {
          console.log(`\n✓ Found ${topics.length} existing topics (use --overwrite to re-extract)\n`);
        } else {
          console.log(`\n✓ Extracted ${topics.length} topics\n`);
        }

        // Display topics in a readable format
        for (const topic of topics) {
          const indent = "  ".repeat(topic.depth);
          const prefix = topic.depth > 0 ? "└─ " : "● ";

          console.log(`${indent}${prefix}${topic.title}`);
          console.log(`${indent}   ${topic.summary}`);
          console.log(`${indent}   Key points: ${topic.keyPoints.length}`);

          if (topic.sourceText) {
            const previewLength = 100;
            const preview = topic.sourceText.length > previewLength
              ? topic.sourceText.substring(0, previewLength) + "..."
              : topic.sourceText;
            console.log(`${indent}   Source text: ${preview}`);
          }
          console.log();
        }

        // Summary
        const mainTopics = topics.filter((t) => t.depth === 0);
        const subtopics = topics.filter((t) => t.depth > 0);
        console.log(`Summary: ${mainTopics.length} main topics, ${subtopics.length} subtopics`);

        getRawDb(db).close();
        process.exit(0);
      } catch (error) {
        console.error(`\n❌ Topic extraction failed: ${(error as Error).message}`);
        process.exit(1);
      } finally {
        await langfuse.flush().catch(() => {});
        await langfuse.shutdown().catch(() => {});
      }
    }
  );

program.parse();
