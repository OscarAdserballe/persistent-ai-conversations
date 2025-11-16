#!/usr/bin/env node

import { Command } from 'commander'
import { loadConfig } from '../config'
import { createDatabase, createEmbeddingModel, createVectorStore, createImporter } from '../factories'
import { getRawDb } from '../db/client'
import { SQL } from '../db/schema'
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
      const drizzleDb = createDatabase(config.db.path)
      const db = getRawDb(drizzleDb) // Extract raw DB for legacy SQL usage
      console.log(`✓ Connected to database: ${config.db.path}`)

      // Create components
      const importer = createImporter(options.platform)
      const embedder = createEmbeddingModel(config)
      const vectorStore = createVectorStore(drizzleDb)
      vectorStore.initialize(embedder.dimensions)
      console.log(`✓ Initialized embedding model (${embedder.dimensions} dimensions)\n`)

      // Process conversations
      let conversationCount = 0
      let messageCount = 0

      for await (const conversation of importer.import(file)) {
        // Insert conversation
        db.prepare(SQL.INSERT_CONVERSATION).run(
          conversation.uuid,
          conversation.title,
          conversation.summary || null,
          conversation.createdAt.toISOString(),
          conversation.updatedAt.toISOString(),
          conversation.platform,
          conversation.messages.length,
          null  // embedding - not computed during ingest
        )

        // Process messages - chunk and embed
        const messages = conversation.messages
        for (const message of messages) {
          // Chunk the message text
          const chunks = chunkText(message.text, 3000)

          // Insert message record
          db.prepare(SQL.INSERT_MESSAGE).run(
            message.uuid,
            message.conversationUuid,
            message.conversationIndex,
            message.sender,
            message.text,
            message.createdAt.toISOString(),
            chunks.length
          )

          // Generate embeddings for all chunks
          const chunkTexts = chunks.map(c => c.text)
          const embeddings = await embedder.embedBatch(chunkTexts)

          // Store chunks with embeddings
          for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i]
            const embedding = embeddings[i]
            const embeddingBuffer = Buffer.from(embedding.buffer)

            db.prepare(SQL.INSERT_CHUNK).run(
              message.uuid,
              chunk.index,
              chunk.text,
              chunk.charCount,
              embeddingBuffer
            )
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

      db.close()
      process.exit(0)
    } catch (error) {
      console.error('\n❌ Error during ingestion:')
      console.error((error as Error).message)
      process.exit(1)
    }
  })

program.parse()
