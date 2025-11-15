#!/usr/bin/env node

import { Command } from "commander";
import * as fs from "fs";
import { loadConfig } from "../config";
import { createDatabase } from "../db/database";
import { createLearningExtractor } from "../factories";
import type { Conversation, Message, Learning } from "../core/types";

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
          .all(start.toISOString(), end.toISOString()) as Conversation[];

        const total = conversations.length;
        console.log(`Processing ${total} conversations...\n`);

        // Extract learnings from each conversation
        const allLearnings: Learning[] = [];
        for (let i = 0; i < conversations.length; i++) {
          const conv = conversations[i];

          // Fetch full conversation with messages
          const messagesRaw = db
            .prepare(
              `
          SELECT * FROM messages
          WHERE conversation_uuid = ?
          ORDER BY conversation_index ASC
        `
            )
            .all(conv.uuid) as any[];

          // Parse message dates (database returns ISO strings)
          const messages: Message[] = messagesRaw.map((msg) => ({
            ...msg,
            createdAt: new Date(msg.created_at),
            conversationUuid: msg.conversation_uuid,
            conversationIndex: msg.conversation_index,
            metadata: {},
          }));

          const fullConv: Conversation = {
            uuid: conv.uuid,
            title: conv.title,
            platform: conv.platform,
            messages,
            createdAt: new Date(conv.createdAt),
            updatedAt: new Date(conv.updatedAt),
            metadata: {},
          };

          const learnings = await extractor.extractFromConversation(fullConv);
          allLearnings.push(...learnings);

          // Progress logging with counter
          console.log(
            `[${i + 1}/${total}] Extracted ${
              learnings.length
            } learnings from "${conv.title}"`
          );
        }

        console.log(`\n✓ Extracted ${allLearnings.length} learnings total`);

        // Generate markdown diary
        const diary = generateMarkdownDiary(allLearnings, start, end);
        fs.writeFileSync(options.output, diary);

        console.log(`\n✓ Diary saved to ${options.output}`);

        if (allLearnings.length > 0) {
          console.log("\nSample learnings:");

          // Show first 3 learnings
          for (const learning of allLearnings.slice(0, 3)) {
            const categoryNames = learning.categories
              .map((c) => c.name)
              .join(", ");
            console.log(`\n[${categoryNames}] ${learning.title}`);
            console.log(learning.content);
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

/**
 * Generate markdown diary grouped by date.
 */
function generateMarkdownDiary(
  learnings: Learning[],
  start: Date,
  end: Date
): string {
  // Group learnings by date
  const byDate = new Map<string, Learning[]>();

  for (const learning of learnings) {
    const dateKey = learning.createdAt.toISOString().split("T")[0];
    if (!byDate.has(dateKey)) {
      byDate.set(dateKey, []);
    }
    byDate.get(dateKey)!.push(learning);
  }

  // Sort dates descending
  const sortedDates = Array.from(byDate.keys()).sort().reverse();

  // Build markdown
  let md = `# Learning Diary\n\n`;
  md += `**Period:** ${start.toISOString().split("T")[0]} to ${
    end.toISOString().split("T")[0]
  }\n`;
  md += `**Total Learnings:** ${learnings.length}\n\n`;
  md += `---\n\n`;

  for (const date of sortedDates) {
    const dateLearnings = byDate.get(date)!;
    md += `## ${date}\n\n`;

    for (const learning of dateLearnings) {
      md += `### ${learning.title}\n\n`;

      // Handle multiple categories
      if (learning.categories.length > 0) {
        const categoryNames = learning.categories.map((c) => c.name).join(", ");
        md += `**Categories:** ${categoryNames}\n\n`;
      }

      md += `${learning.content}\n\n`;

      // Add source links
      if (learning.sources.length > 0) {
        md += `**Sources:**\n`;
        for (const source of learning.sources) {
          md += `- Conversation: \`${source.conversationUuid}\`\n`;
        }
        md += `\n`;
      }

      md += `---\n\n`;
    }
  }

  return md;
}
