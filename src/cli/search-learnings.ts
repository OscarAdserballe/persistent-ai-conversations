#!/usr/bin/env node

import { Command } from "commander";
import { loadConfig } from "../config";
import { createLearningSearch, createDatabase } from "../factories";
import { getRawDb } from "../db/client";
import { Learning, LearningSearchResult } from "../core/types";

const program = new Command();

program
  .name("search-learnings")
  .description("Search learnings semantically")
  .argument("<query>", "Search query")
  .option("-c, --config <path>", "Path to config file", "./config.json")
  .option("-l, --limit <number>", "Maximum number of results", "20")
  .option("--after <date>", "Filter learnings after this date (YYYY-MM-DD)")
  .option("--before <date>", "Filter learnings before this date (YYYY-MM-DD)")
  .option("--detailed", "Show detailed view (default is summary view)")
  .action(
    async (
      query: string,
      options: {
        config: string;
        limit: string;
        after?: string;
        before?: string;
        detailed?: boolean;
      }
    ) => {
      try {
        // Load configuration
        const config = loadConfig(options.config);

        // Create database connection
        const db = createDatabase(config.db.path);

        // Create learning search
        const learningSearch = createLearningSearch(config, db);

        // Build search options
        const searchOptions: {
          limit: number;
          dateRange?: { start: Date; end: Date };
        } = {
          limit: parseInt(options.limit, 10),
        };

        // Only set dateRange if both start and end can be determined
        if (options.after || options.before) {
          const start = options.after ? new Date(options.after) : new Date(0);
          const end = options.before ? new Date(options.before) : new Date();
          searchOptions.dateRange = { start, end };
        }

        console.log(`Searching learnings for: "${query}"\n`);

        // Execute search
        const results = await learningSearch.search(query, searchOptions);

        if (results.length === 0) {
          console.log("No learnings found.");
          getRawDb(db).close();
          process.exit(0);
        }

        console.log(`Found ${results.length} learning(s):\n`);

        // Display results (summary or detailed view)
        for (const result of results) {
          if (options.detailed) {
            displayDetailedLearning(result);
          } else {
            displaySummaryLearning(result.learning, result.score);
          }
        }

        getRawDb(db).close();
        process.exit(0);
      } catch (error) {
        console.error(`Learning search failed: ${(error as Error).message}`);
        console.error(`\nTroubleshooting:`);
        console.error(`  - Check your API key in config.json`);
        console.error(`  - Ensure database exists`);
        console.error(`  - Verify embeddings are generated for learnings`);
        process.exit(1);
      }
    }
  );

program.parse();

// Display functions

function displaySummaryLearning(learning: Learning, score: number): void {
  console.log(`* ${learning.title}`);
  console.log(`  -> ${learning.insight.substring(0, 100)}...`);
  console.log(
    `  Score: ${(score * 100).toFixed(1)}% | Date: ${
      learning.createdAt.toISOString().split("T")[0]
    } | Source: ${learning.sourceType}`
  );
  console.log();
}

function displayDetailedLearning(result: LearningSearchResult): void {
  const { learning, score, sourceConversation, sourceTopic } = result;

  console.log("=".repeat(80));
  console.log(`${learning.title}`);
  console.log(
    `Score: ${(score * 100).toFixed(1)}% | Date: ${
      learning.createdAt.toISOString().split("T")[0]
    }`
  );
  console.log("=".repeat(80));
  console.log();

  console.log(`Problem Space: ${learning.problemSpace}`);
  console.log();

  console.log(`Insight: ${learning.insight}`);
  console.log();

  if (learning.blocks.length > 0) {
    console.log("Blocks:");
    for (const block of learning.blocks) {
      console.log(`  [${block.blockType}] Q: ${block.question}`);
      console.log(`           A: ${block.answer}`);
      console.log();
    }
  }

  // Display source
  console.log("Source:");
  if (sourceConversation) {
    console.log(
      `  Conversation: "${sourceConversation.title}" (${
        sourceConversation.createdAt.toISOString().split("T")[0]
      })`
    );
  } else if (sourceTopic) {
    console.log(
      `  Topic: "${sourceTopic.title}" from PDF "${sourceTopic.pdfTitle ?? sourceTopic.pdfId}"`
    );
  } else {
    console.log(`  ${learning.sourceType}: ${learning.sourceId}`);
  }
  console.log();
}
