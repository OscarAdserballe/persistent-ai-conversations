#!/usr/bin/env node

import { Command } from "commander";
import { LangfuseClient } from "@langfuse/client";
import { loadConfig } from "../config";
import { createLearningExtractor, createDatabase } from "../factories";
import { getLangfusePrompt } from "../prompts/get-langfuse-prompt";
import { getRawDb } from "../db/client";
import {
  getConversationByUuid,
  getRandomConversation,
  getConversationUuidsByDateRange,
  extractLearnings,
} from "../api";

const program = new Command();

program
  .name("extract-learnings")
  .description("Extract learnings from conversations using LLM")
  .option("-c, --config <path>", "Path to config file", "./config.json")
  .option("-d, --days <number>", "Extract from last N days", "10")
  .option("--all", "Extract from all conversations")
  .option("--start-date <date>", "Start date (YYYY-MM-DD)")
  .option("--end-date <date>", "End date (YYYY-MM-DD)")
  .option("--preview", "Preview mode: Run on ONE conversation, no DB writes")
  .option("--overwrite", "Overwrite existing learnings (re-extract)")
  .option("--id <uuid>", "Specific conversation UUID (for preview)")
  .action(async (options) => {
    const langfuse = new LangfuseClient();

    try {
      const config = loadConfig(options.config);
      const db = createDatabase(config.db.path);

      // Fetch prompt from Langfuse
      const promptName = config.prompts?.learningExtraction;
      if (!promptName) {
        throw new Error(
          "Missing config.prompts.learningExtraction (Langfuse prompt name)."
        );
      }
      const promptTemplate = await getLangfusePrompt(langfuse, promptName);
      const extractor = createLearningExtractor(config, db, promptTemplate);

      // Determine date range
      let start: Date;
      let end: Date = new Date();

      if (options.all) {
        start = new Date(0);
      } else if (options.startDate && options.endDate) {
        start = new Date(options.startDate);
        end = new Date(options.endDate);
      } else {
        const days = parseInt(options.days || "10", 10);
        start = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      }

      // PREVIEW MODE
      if (options.preview) {
        console.log("🔍 PREVIEW MODE (No Database Writes)\n");

        const conversation = options.id
          ? getConversationByUuid(db, options.id)
          : getRandomConversation(db, start, end);

        console.log(
          `Analyzing: "${conversation.title}" (${conversation.uuid})`
        );
        const learnings = await extractor.extractFromConversation(conversation);

        console.log("\n=== EXTRACTED LEARNINGS ===\n");
        console.log(JSON.stringify(learnings, null, 2));
        console.log(`\nTotal: ${learnings.length}`);

        getRawDb(db).close();
        process.exit(0);
      }

      // BATCH MODE
      console.log(
        `Extracting learnings from ${start.toISOString().split("T")[0]} to ${
          end.toISOString().split("T")[0]
        }...\n`
      );

      const uuids = getConversationUuidsByDateRange(db, start, end);
      console.log(`Processing ${uuids.length} conversations...\n`);

      const learnings = await extractLearnings({
        db,
        extractor,
        conversationUuids: uuids,
        concurrency: 10,
        overwrite: options.overwrite,
        onProgress: (completed, total, title) => {
          console.log(`[${completed}/${total}] ✓ ${title}`);
        },
        onError: (uuid, error) => {
          console.error(`[ERROR] ${uuid}: ${error.message}`);
        },
      });

      console.log(`\n✓ Extracted ${learnings.length} learnings total`);

      if (learnings.length > 0) {
        console.log("\nSample learnings:");
        for (const learning of learnings.slice(0, 3)) {
          console.log(`\n• ${learning.title}`);
          console.log(`  ${learning.insight.substring(0, 100)}...`);
        }
      }

      getRawDb(db).close();
      process.exit(0);
    } catch (error) {
      console.error(
        `❌ Learning extraction failed: ${(error as Error).message}`
      );
      process.exit(1);
    } finally {
      await langfuse.flush().catch(() => {});
      await langfuse.shutdown().catch(() => {});
    }
  });

program.parse();
