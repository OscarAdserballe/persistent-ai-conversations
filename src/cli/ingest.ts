#!/usr/bin/env node

import { Command } from 'commander'
import { loadConfig } from '../config'
import { createDatabase, createEmbeddingModel, createVectorStore, createImporter } from '../factories'
import { conversations, messages, messageChunks } from '../db/schema'
import { getRawDb } from '../db/client'
import { chunkText } from '../utils/chunking'

const program = new Command()

program
  .name('ingest')
  .description('Import and index LLM conversations')
  .argument('<file>', 'Path to conversations export file (e.g., conversations.json)')
  .option('-c, --config <path>', 'Path to config file', './config.json')
  .option('-p, --platform <platform>', 'Platform type (claude, openai)', 'claude')
  .action(async (file: string, options: { config: string; platform: string }) => {
    try {
      console.log('Starting ingestion...\n')

      // Load configuration
      const config = loadConfig(options.config)
      console.log(`✓ Loaded configuration from ${options.config}`)

      // Create database connection (returns DrizzleDB now)
      const db = createDatabase(config.db.path)
      console.log(`✓ Connected to database: ${config.db.path}`)

      // Create components
      const importer = createImporter(options.platform)
      const embedder = createEmbeddingModel(config)
      const vectorStore = createVectorStore(db)
      vectorStore.initialize(embedder.dimensions)
      console.log(`✓ Initialized embedding model (${embedder.dimensions} dimensions)\n`)

      // Process conversations
      let conversationCount = 0
      let messageCount = 0

      for await (const conversation of importer.import(file)) {
        // Insert conversation using Drizzle
        await db.insert(conversations).values({
          uuid: conversation.uuid,
          name: conversation.title,
          summary: conversation.summary || null,
          createdAt: conversation.createdAt,
          updatedAt: conversation.updatedAt,
          platform: conversation.platform,
          messageCount: conversation.messages.length,
          embedding: null  // not computed during ingest
        })

        // Process messages - chunk and embed
        const conversationMessages = conversation.messages
        for (const message of conversationMessages) {
          // Chunk the message text
          const chunks = chunkText(message.text, 3000)

          // Insert message record using Drizzle
          await db.insert(messages).values({
            uuid: message.uuid,
            conversationUuid: message.conversationUuid,
            conversationIndex: message.conversationIndex,
            sender: message.sender,
            text: message.text,
            createdAt: message.createdAt,
            chunkCount: chunks.length
          })

          // Generate embeddings for all chunks
          const chunkTexts = chunks.map(c => c.text)
          const embeddings = await embedder.embedBatch(chunkTexts)

          // Store chunks with embeddings using Drizzle
          for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i]
            const embedding = embeddings[i]

            await db.insert(messageChunks).values({
              messageUuid: message.uuid,
              chunkIndex: chunk.index,
              text: chunk.text,
              charCount: chunk.charCount,
              embedding: Buffer.from(embedding.buffer)
            })
          }

          messageCount++

          if (config.ingestion.progressLogging) {
            console.log(`  Processed ${messageCount} messages...`)
          }
        }

        conversationCount++
      }

      console.log(`\n✓ Successfully imported:`)
      console.log(`  - ${conversationCount} conversations`)
      console.log(`  - ${messageCount} messages`)
      console.log(`\nDone! 🎉`)

      getRawDb(db).close()
      process.exit(0)
    } catch (error) {
      console.error('\n❌ Error during ingestion:')
      console.error((error as Error).message)
      process.exit(1)
    }
  })

program.parse()
