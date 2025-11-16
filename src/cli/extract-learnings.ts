#!/usr/bin/env node

import { Command } from "commander";
import * as fs from "fs";
import pLimit from "p-limit";
import { loadConfig } from "../config";
import { createLearningExtractor } from "../factories";
import type {
  Conversation,
  Message,
  Learning,
  LearningExtractor,
} from "../core/types";

const program = new Command();

program
  .name("extract-learnings")
  .description("Extract learnings from conversations using LLM")
  .option("-c, --config <path>", "Path to config file", "./config.json")
  .option("-d, --days <number>", "Extract from last N days", "10")
  .option("--all", "Extract from all conversations")
  .option("--start-date <date>", "Start date (YYYY-MM-DD)")
  .option("--end-date <date>", "End date (YYYY-MM-DD)")
  .option(
    "-o, --output <path>",
    "Output diary path",
    "./data/learning-diary.md"
  )
  .action(
    async (options: {
      config: string;
      days?: string;
      all?: boolean;
      startDate?: string;
      endDate?: string;
      output: string;
    }) => {
      try {
        // Load configuration
        const config = loadConfig(options.config);

        // Create database connection
        const db = createDatabase(config.db.path);

        // Create learning extractor
        const extractor = createLearningExtractor(config, db);

        // Determine date range
        let start: Date;
        let end: Date = new Date();

        if (options.all) {
          start = new Date(0); // Beginning of time
        } else if (options.startDate && options.endDate) {
          start = new Date(options.startDate);
          end = new Date(options.endDate);
        } else {
          const days = parseInt(options.days || "10", 10);
          start = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        }

        console.log(
          `Extracting learnings from ${start.toISOString().split("T")[0]} to ${
            end.toISOString().split("T")[0]
          }...\n`
        );

        // Fetch conversations in date range
        const conversations = db
          .prepare(
            `
        SELECT * FROM conversations
        WHERE created_at >= ? AND created_at <= ?
        ORDER BY created_at DESC
      `
          )
          .all(start.toISOString(), end.toISOString()) as any[];

        const total = conversations.length;
        console.log(`Processing ${total} conversations...\n`);

        // Create semaphore with limit of 10 concurrent operations
        const limit = pLimit(10);

        // Helper function to extract with retry logic
        const extractWithRetry = async (
          extractor: LearningExtractor,
          conversation: Conversation,
          maxRetries = 3
        ): Promise<Learning[]> => {
          let lastError: Error | undefined;

          for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
              return await extractor.extractFromConversation(conversation);
            } catch (error) {
              lastError = error as Error;

              // Check if it's a rate limit error
              const isRateLimit =
                lastError.message.includes("429") ||
                lastError.message.includes("rate limit");

              if (attempt < maxRetries) {
                // Exponential backoff: 2^attempt seconds
                const delayMs = Math.pow(2, attempt) * 1000;
                console.log(
                  `  Retry ${attempt}/${maxRetries} after ${delayMs}ms... (${lastError.message.substring(
                    0,
                    50
                  )})`
                );
                await new Promise((resolve) => setTimeout(resolve, delayMs));
              }
            }
          }

          // After max retries, throw
          throw new Error(
            `Failed after ${maxRetries} attempts: ${lastError!.message}`
          );
        };

        // Convert to promises with concurrency control
        const extractionPromises = conversations.map((conv, i) =>
          limit(async () => {
            // Check if already processed
            const existing = db
              .prepare(
                `
              SELECT COUNT(*) as count FROM learnings 
              WHERE conversation_uuid = ?
            `
              )
              .get(conv.uuid) as { count: number };

            if (existing.count > 0) {
              console.log(
                `[${i + 1}/${total}] ⊘ Skipping "${
                  conv.name
                }" (already processed)`
              );
              return [];
            }

            try {
              // Fetch messages
              const messagesRaw = db
                .prepare(
                  `
                SELECT * FROM messages 
                WHERE conversation_uuid = ? 
                ORDER BY conversation_index ASC
              `
                )
                .all(conv.uuid) as any[];

              const messages: Message[] = messagesRaw.map((msg) => ({
                ...msg,
                createdAt: new Date(msg.created_at),
                conversationUuid: msg.conversation_uuid,
                conversationIndex: msg.conversation_index,
                metadata: {},
              }));

              const fullConv: Conversation = {
                uuid: conv.uuid,
                title: conv.name,
                platform: conv.platform,
                messages,
                createdAt: new Date(conv.created_at),
                updatedAt: new Date(conv.updated_at),
                metadata: {},
              };

              // Extract with retry
              const learnings = await extractWithRetry(extractor, fullConv);

              console.log(
                `[${i + 1}/${total}] ✓ Extracted ${
                  learnings.length
                } learnings from "${conv.name}"`
              );
              return learnings;
            } catch (error) {
              console.error(
                `[${i + 1}/${total}] ✗ Failed "${conv.name}": ${
                  (error as Error).message
                }`
              );
              return []; // Return empty, don't crash entire process
            }
          })
        );

        // Wait for all to complete
        const results = await Promise.all(extractionPromises);
        const allLearnings = results.flat();

        console.log(`\n✓ Extracted ${allLearnings.length} learnings total`);

        if (allLearnings.length > 0) {
          console.log("\nSample learnings:");

          // Show first 3 learnings
          for (const learning of allLearnings.slice(0, 3)) {
            const tagNames = learning.tags.join(", ");
            console.log(`\n[${tagNames}] ${learning.title}`);
            console.log(learning.insight);
          }
        }

        db.close();
        process.exit(0);
      } catch (error) {
        console.error(
          `❌ Learning extraction failed: ${(error as Error).message}`
        );
        console.error(`\nTroubleshooting:`);
        console.error(`  - Check your API keys in config.json`);
        console.error(`  - Ensure database exists`);
        console.error(`  - Verify LLM model is available`);
        console.error(`  - Check rate limits on API`);
        process.exit(1);
      }
    }
  );

program.parse();
