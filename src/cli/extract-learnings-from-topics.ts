#!/usr/bin/env node

import { Command } from "commander";
import { eq } from "drizzle-orm";
import { LangfuseClient } from "@langfuse/client";
import { loadConfig } from "../config";
import { createTopicLearningExtractor, createDatabase } from "../factories";
import { getLangfusePrompt } from "../prompts/get-langfuse-prompt";
import { getRawDb } from "../db/client";
import { topics as topicsTable, pdfDocuments } from "../db/schema";
import type { Topic } from "../core/types";

const program = new Command();

// Default prompt for topic → learning extraction
const DEFAULT_PROMPT = `You are extracting exam-prep flashcards from academic content.

Given a TOPIC with its summary and key points, create learnings with:

1. **title**: Specific, memorable - something you'd recognize in a flashcard deck
2. **problemSpace**: "When/why would you need this?" - the situation that makes this relevant
3. **insight**: Core realization (1-2 sentences) - the "aha!" moment
4. **blocks**: Array of Q&A pairs (aim for 8-15), each with:
   - blockType: 'qa' | 'why' | 'contrast'
   - question: Front of flashcard
   - answer: Back of flashcard

Block type guidelines:
- 'qa': Definitions, procedures, proof outlines, formulas
- 'why': "Why is X true?" - forces deeper understanding
- 'contrast': "How does X differ from Y?" - highlights distinctions

Example proof outline block:
{
  "blockType": "qa",
  "question": "What's the proof outline for [theorem]?",
  "answer": "1. [Step 1]\\n2. [Step 2]\\n3. [Step 3]\\n4. [Conclusion]"
}

Return a JSON array of learnings. Be thorough - more blocks means better flashcard coverage.
If the topic has no substantial learning content, return an empty array.`;

program
  .name("extract-learnings-from-topics")
  .description("Extract learnings from topics (from PDFs) using LLM")
  .option("-c, --config <path>", "Path to config file", "./config.json")
  .option("--pdf-id <id>", "Extract from all topics of a specific PDF")
  .option("--topic-id <id>", "Extract from a specific topic only")
  .option(
    "-p, --prompt <name>",
    "Langfuse prompt name",
    "topic_learning_extraction"
  )
  .option("--use-default-prompt", "Skip Langfuse, use built-in default prompt")
  .option("--dry-run", "Show topics that would be processed without extracting")
  .option("--delay <ms>", "Delay between extractions (ms)", "1000")
  .action(
    async (options: {
      config: string;
      pdfId?: string;
      topicId?: string;
      prompt: string;
      useDefaultPrompt?: boolean;
      dryRun?: boolean;
      delay: string;
    }) => {
      const langfuse = new LangfuseClient();

      try {
        if (!options.pdfId && !options.topicId) {
          console.error("Error: Must specify either --pdf-id or --topic-id");
          process.exit(1);
        }

        const config = loadConfig(options.config);
        const db = createDatabase(config.db.path);
        const delayMs = parseInt(options.delay, 10);

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

        // Fetch topics to process
        let topicsToProcess: Topic[] = [];

        if (options.topicId) {
          const topic = await db
            .select()
            .from(topicsTable)
            .where(eq(topicsTable.topicId, options.topicId))
            .get();

          if (!topic) {
            console.error(`Topic not found: ${options.topicId}`);
            process.exit(1);
          }

          topicsToProcess = [
            {
              topicId: topic.topicId,
              title: topic.title,
              summary: topic.summary,
              keyPoints: topic.keyPoints,
              sourcePassages: topic.sourcePassages ?? undefined,
              pdfId: topic.pdfId,
              parentTopicId: topic.parentTopicId ?? undefined,
              depth: topic.depth,
              createdAt: topic.createdAt,
              embedding: topic.embedding
                ? new Float32Array(topic.embedding.buffer)
                : undefined,
            },
          ];
        } else if (options.pdfId) {
          // Verify PDF exists
          const pdf = await db
            .select()
            .from(pdfDocuments)
            .where(eq(pdfDocuments.id, options.pdfId))
            .get();

          if (!pdf) {
            console.error(`PDF not found: ${options.pdfId}`);
            process.exit(1);
          }

          console.log(`PDF: ${pdf.title || pdf.filename}`);

          const dbTopics = await db
            .select()
            .from(topicsTable)
            .where(eq(topicsTable.pdfId, options.pdfId))
            .all();

          topicsToProcess = dbTopics.map((t) => ({
            topicId: t.topicId,
            title: t.title,
            summary: t.summary,
            keyPoints: t.keyPoints,
            sourcePassages: t.sourcePassages ?? undefined,
            pdfId: t.pdfId,
            parentTopicId: t.parentTopicId ?? undefined,
            depth: t.depth,
            createdAt: t.createdAt,
            embedding: t.embedding
              ? new Float32Array(t.embedding.buffer)
              : undefined,
          }));
        }

        if (topicsToProcess.length === 0) {
          console.log("No topics found to process");
          process.exit(0);
        }

        console.log(`Found ${topicsToProcess.length} topics to process\n`);

        if (options.dryRun) {
          console.log("DRY RUN - Topics that would be processed:\n");
          for (const topic of topicsToProcess) {
            const indent = "  ".repeat(topic.depth);
            console.log(`${indent}● ${topic.title}`);
            console.log(`${indent}  ${topic.summary.slice(0, 100)}...`);
            console.log(`${indent}  Key points: ${topic.keyPoints.length}`);
            console.log();
          }
          getRawDb(db).close();
          process.exit(0);
        }

        // Create extractor
        const extractor = createTopicLearningExtractor(
          config,
          db,
          promptTemplate
        );

        // Process topics
        let totalLearnings = 0;
        let processedTopics = 0;

        for (const topic of topicsToProcess) {
          processedTopics++;
          const progress = `[${processedTopics}/${topicsToProcess.length}]`;

          console.log(`${progress} Processing: ${topic.title}`);

          try {
            const learnings = await extractor.extractFromTopic(topic);
            totalLearnings += learnings.length;

            console.log(`  ✓ Extracted ${learnings.length} learnings`);

            // Show learning titles
            for (const learning of learnings) {
              console.log(`    - ${learning.title}`);
              console.log(`      ${learning.blocks.length} blocks`);
            }
          } catch (error) {
            console.error(`  ✗ Failed: ${(error as Error).message}`);
          }

          // Rate limiting delay between topics
          if (processedTopics < topicsToProcess.length && delayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, delayMs));
          }
        }

        console.log(`\n${"=".repeat(50)}`);
        console.log(
          `✓ Complete: ${totalLearnings} learnings from ${processedTopics} topics`
        );

        getRawDb(db).close();
        process.exit(0);
      } catch (error) {
        console.error(
          `\n❌ Extraction failed: ${(error as Error).message}`
        );
        process.exit(1);
      } finally {
        await langfuse.flush().catch(() => {});
        await langfuse.shutdown().catch(() => {});
      }
    }
  );

program.parse();
