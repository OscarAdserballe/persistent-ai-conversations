#!/usr/bin/env node

import { Command } from "commander";
import { eq, inArray } from "drizzle-orm";
import pLimit from "p-limit";
import { loadConfig } from "../config";
import {
  createDatabase,
  createEmbeddingModel,
  createVectorStore,
  createImporter,
} from "../factories";
import { conversations, messages, messageChunks } from "../db/schema";
import { getRawDb } from "../db/client";
import { chunkText } from "../utils/chunking";
import type { Conversation } from "../core/types";

const program = new Command();

program
  .name("ingest")
  .description("Import and index LLM conversations")
  .argument(
    "<file>",
    "Path to conversations export file (e.g., conversations.json)"
  )
  .option("-c, --config <path>", "Path to config file", "./config.json")
  .option(
    "-p, --platform <platform>",
    "Platform type (claude, openai)",
    "claude"
  )
  .action(
    async (file: string, options: { config: string; platform: string }) => {
      try {
        console.log("Starting ingestion...\n");

        // Load configuration
        const config = loadConfig(options.config);
        console.log(`✓ Loaded configuration from ${options.config}`);

        // Create database connection (returns DrizzleDB now)
        const db = createDatabase(config.db.path);
        console.log(`✓ Connected to database: ${config.db.path}`);

        // Create components
        const importer = createImporter(options.platform);
        const embedder = createEmbeddingModel(config);
        const vectorStore = createVectorStore(db);
        vectorStore.initialize(embedder.dimensions);
        console.log(
          `✓ Initialized embedding model (${embedder.dimensions} dimensions)\n`
        );

        // Step 1: Load all conversations from import file into memory
        console.log("Loading conversations from file...");
        const allConversations: Conversation[] = [];
        for await (const conversation of importer.import(file)) {
          allConversations.push(conversation);
        }
        console.log(`✓ Loaded ${allConversations.length} conversations\n`);

        // Step 2: Batch query existing conversations
        const allConvUuids = allConversations.map((c) => c.uuid);
        const existingConvs =
          allConvUuids.length > 0
            ? await db
                .select({ uuid: conversations.uuid })
                .from(conversations)
                .where(inArray(conversations.uuid, allConvUuids))
            : [];

        const existingConvUuidSet = new Set(existingConvs.map((c) => c.uuid));
        console.log(
          `✓ Found ${existingConvUuidSet.size} existing conversations in database`
        );

        // Step 3: Filter new conversations
        const newConversations = allConversations.filter(
          (c) => !existingConvUuidSet.has(c.uuid)
        );
        console.log(
          `✓ ${newConversations.length} new conversations to import\n`
        );

        // Step 4: Insert new conversations
        for (const conv of newConversations) {
          await db.insert(conversations).values({
            uuid: conv.uuid,
            name: conv.title,
            summary: conv.summary || null,
            createdAt: conv.createdAt,
            updatedAt: conv.updatedAt,
            platform: conv.platform,
            messageCount: conv.messages.length,
            embedding: null, // not computed during ingest
          });
        }

        if (newConversations.length > 0) {
          console.log(`✓ Inserted ${newConversations.length} conversations\n`);
        }

        // Step 5: Process messages in parallel with p-limit
        const concurrency = config.ingestion.concurrency;
        const limit = pLimit(concurrency);
        console.log(
          `Processing messages with concurrency limit: ${concurrency}\n`
        );

        let totalMessagesProcessed = 0;
        let totalMessagesSkipped = 0;

        for (const conv of allConversations) {
          // Batch query existing messages for this conversation
          const existingMsgs = await db
            .select({ uuid: messages.uuid })
            .from(messages)
            .where(eq(messages.conversationUuid, conv.uuid));

          const existingMsgUuidSet = new Set(existingMsgs.map((m) => m.uuid));
          const newMessages = conv.messages.filter(
            (m) => !existingMsgUuidSet.has(m.uuid)
          );

          totalMessagesSkipped += conv.messages.length - newMessages.length;

          if (newMessages.length === 0) {
            continue; // Skip conversation if all messages already exist
          }

          console.log(
            `Processing conversation "${conv.title}" (${newMessages.length} new messages)...`
          );

          // Process new messages in parallel
          const promises = newMessages.map((message) =>
            limit(async () => {
              // Chunk the message text
              const chunks = chunkText(message.text, 3000);

              // Insert message record using Drizzle
              await db.insert(messages).values({
                uuid: message.uuid,
                conversationUuid: message.conversationUuid,
                conversationIndex: message.conversationIndex,
                sender: message.sender,
                text: message.text,
                createdAt: message.createdAt,
                chunkCount: chunks.length,
              });

              // Generate embeddings for all chunks with retry logic
              const chunkTexts = chunks.map((c) => c.text);
              let embeddings: Float32Array[] = [];
              let retries = 0;
              const maxRetries = 3;

              while (retries <= maxRetries) {
                try {
                  embeddings = await embedder.embedBatch(chunkTexts);
                  break; // Success, exit retry loop
                } catch (error) {
                  retries++;
                  if (retries > maxRetries) {
                    console.error(
                      `\n❌ Failed to generate embeddings after ${maxRetries} retries`
                    );
                    console.error(`   Message UUID: ${message.uuid}`);
                    console.error(`   Error: ${(error as Error).message}`);
                    throw error; // Re-throw after exhausting retries
                  }

                  // Exponential backoff: 2^retry seconds
                  const delayMs = Math.pow(2, retries) * 1000;
                  console.log(
                    `\n⚠️  Retry ${retries}/${maxRetries} after ${delayMs}ms (${(
                      error as Error
                    ).message.substring(0, 50)}...)`
                  );
                  await new Promise((resolve) => setTimeout(resolve, delayMs));
                }
              }

              // Store chunks with embeddings using Drizzle
              for (let i = 0; i < chunks.length; i++) {
                const chunk = chunks[i];
                const embedding = embeddings[i];

                await db.insert(messageChunks).values({
                  messageUuid: message.uuid,
                  chunkIndex: chunk.index,
                  text: chunk.text,
                  charCount: chunk.charCount,
                  embedding: Buffer.from(embedding.buffer),
                });
              }

              totalMessagesProcessed++;

              if (config.ingestion.progressLogging) {
                console.log(
                  `  [${totalMessagesProcessed}/${
                    allConversations.reduce(
                      (sum, c) => sum + c.messages.length,
                      0
                    ) - totalMessagesSkipped
                  }] Processed message ${message.uuid.substring(0, 8)}...`
                );
              }
            })
          );

          await Promise.all(promises);
        }

        console.log(`\n✓ Successfully imported:`);
        console.log(`  - ${newConversations.length} new conversations`);
        console.log(`  - ${totalMessagesProcessed} new messages processed`);
        console.log(
          `  - ${totalMessagesSkipped} messages skipped (already existed)`
        );
        console.log(`\nDone! 🎉`);

        getRawDb(db).close();
        process.exit(0);
      } catch (error) {
        console.error("\n❌ Error during ingestion:");
        console.error((error as Error).message);
        process.exit(1);
      }
    }
  );

program.parse();
