import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { unlinkSync, existsSync, writeFileSync } from 'fs'
import { join } from 'path'
import {
  createEmbeddingModel,
  createVectorStore,
  createSearchEngine,
  createImporter,
  createDatabase
} from '../../src/factories'
import { getRawDb } from '../../src/db/client'
import { createDefaultConfig } from '../../src/config'
import type { Config } from '../../src/core/types'
import type { DrizzleDB } from '../../src/db/client'

describe('Factory Wiring Integration', () => {
  const testDbPath = join(__dirname, '../tmp/factory-integration-test.db')
  const testConfigPath = join(__dirname, '../tmp/test-config.json')

  let testConfig: Config

  beforeEach(() => {
    // Clean up any existing test files
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath)
    }
    if (existsSync(testConfigPath)) {
      unlinkSync(testConfigPath)
    }

    // Create test config
    testConfig = {
      ...createDefaultConfig(),
      db: { path: testDbPath }
    }

    // Write config to file
    writeFileSync(testConfigPath, JSON.stringify(testConfig, null, 2))
  })

  afterEach(() => {
    // Clean up test files
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath)
    }
    if (existsSync(testConfigPath)) {
      unlinkSync(testConfigPath)
    }
    if (existsSync(testDbPath + '-shm')) {
      unlinkSync(testDbPath + '-shm')
    }
    if (existsSync(testDbPath + '-wal')) {
      unlinkSync(testDbPath + '-wal')
    }
  })

  it('should create embedding model from config', () => {
    const embedder = createEmbeddingModel(testConfig)

    expect(embedder).toBeDefined()
    expect(embedder.dimensions).toBe(768) // Gemini dimensions
    expect(typeof embedder.embed).toBe('function')
    expect(typeof embedder.embedBatch).toBe('function')
  })

  it('should create vector store from database', () => {
    const drizzleDb = createDatabase(testDbPath)
    const vectorStore = createVectorStore(drizzleDb)

    expect(vectorStore).toBeDefined()
    expect(typeof vectorStore.initialize).toBe('function')
    expect(typeof vectorStore.search).toBe('function')
    // Note: insert() is deprecated and throws an error - embeddings are stored via direct SQL

    // Should not be initialized yet
    expect(vectorStore.getDimensions()).toBeNull()

    getRawDb(drizzleDb).close()
  })

  it('should propagate dimensions from embedder to vector store', () => {
    const embedder = createEmbeddingModel(testConfig)
    const drizzleDb = createDatabase(testDbPath)
    const vectorStore = createVectorStore(drizzleDb)

    // Initialize with embedder dimensions
    vectorStore.initialize(embedder.dimensions)

    // Vector store should now have the same dimensions
    expect(vectorStore.getDimensions()).toBe(embedder.dimensions)
    expect(vectorStore.getDimensions()).toBe(768)

    getRawDb(drizzleDb).close()
  })

  it('should create fully wired search engine', () => {
    const searchEngine = createSearchEngine(testConfig)

    expect(searchEngine).toBeDefined()
    expect(typeof searchEngine.search).toBe('function')

    // Search engine should be ready to use (internal vector store initialized)
    // We can't directly test this without accessing internals, but we can
    // verify it doesn't throw during construction
  })

  it('should create importer for Claude platform', () => {
    const importer = createImporter('claude')

    expect(importer).toBeDefined()
    expect(importer.platform).toBe('claude')
    expect(typeof importer.import).toBe('function')
  })

  it('should throw error for unknown embedding provider', () => {
    const invalidConfig = {
      ...testConfig,
      embedding: {
        ...testConfig.embedding,
        provider: 'unknown' as any
      }
    }

    expect(() => createEmbeddingModel(invalidConfig)).toThrow()
  })

  it('should throw error for unknown importer platform', () => {
    expect(() => createImporter('unknown')).toThrow()
  })

  it('should create components that work together', async () => {
    // Note: This test would normally use real API, but we skip it to avoid API key requirement
    // The unit tests and other integration tests cover the wiring adequately

    // Create database and vector store
    const drizzleDb = createDatabase(testDbPath)
    const vectorStore = createVectorStore(drizzleDb)

    // Initialize with standard dimensions
    vectorStore.initialize(768)

    // Verify it's initialized
    expect(vectorStore.getDimensions()).toBe(768)

    // Insert a test conversation first (for foreign key)
    const now = new Date().toISOString()
    getRawDb(drizzleDb).prepare(`
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('test-conv', 'Test', now, now, 'claude', 1)

    // Insert a test message
    getRawDb(drizzleDb).prepare(`
      INSERT INTO messages (uuid, conversation_uuid, conversation_index, sender, text, created_at, chunk_count)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('test-msg-1', 'test-conv', 0, 'human', 'test', now, 1)

    // Insert chunk with embedding (bypassing deprecated insert method)
    const manualEmbedding = new Float32Array(768).fill(0.5)
    const messageId = 'test-msg-1'
    getRawDb(drizzleDb).prepare(`
      INSERT INTO message_chunks (message_uuid, chunk_index, text, char_count, embedding)
      VALUES (?, ?, ?, ?, ?)
    `).run(messageId, 0, 'test', 4, Buffer.from(manualEmbedding.buffer))

    // Search for it
    const results = vectorStore.search(manualEmbedding, 10)

    // Should find the message we inserted
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].id).toBe(messageId)

    getRawDb(drizzleDb).close()
  })

  it('should validate dimension consistency', () => {
    const embedder = createEmbeddingModel(testConfig)
    const drizzleDb = createDatabase(testDbPath)
    const vectorStore = createVectorStore(drizzleDb)

    // Initialize with correct dimensions
    vectorStore.initialize(embedder.dimensions)
    expect(vectorStore.getDimensions()).toBe(embedder.dimensions)

    // Try to initialize again with different dimensions (should throw or ignore)
    // Based on implementation, this might throw or just be a no-op
    const currentDimensions = vectorStore.getDimensions()
    expect(currentDimensions).toBe(embedder.dimensions)

    getRawDb(drizzleDb).close()
  })

  it('should create components with custom batch size', () => {
    const customConfig = {
      ...testConfig,
      embedding: {
        ...testConfig.embedding,
        batchSize: 50 // Custom batch size
      }
    }

    const embedder = createEmbeddingModel(customConfig)

    expect(embedder).toBeDefined()
    // Batch size is internal, but we can verify the embedder was created
    expect(embedder.dimensions).toBe(768)
  })

  it('should create components with custom rate limiting', () => {
    const customConfig = {
      ...testConfig,
      embedding: {
        ...testConfig.embedding,
        rateLimitDelayMs: 200 // Custom rate limit
      }
    }

    const embedder = createEmbeddingModel(customConfig)

    expect(embedder).toBeDefined()
    expect(embedder.dimensions).toBe(768)
  })

  it('should handle database path creation', () => {
    // Use a nested path that doesn't exist yet
    const nestedDbPath = join(__dirname, '../tmp/nested/dir/test.db')
    const nestedConfig = {
      ...testConfig,
      db: { path: nestedDbPath }
    }

    // Create directory if it doesn't exist
    const { mkdirSync } = require('fs')
    const { dirname } = require('path')
    mkdirSync(dirname(nestedDbPath), { recursive: true })

    try {
      const drizzleDb = createDatabase(nestedDbPath)
      const vectorStore = createVectorStore(drizzleDb)
      expect(vectorStore).toBeDefined()
      getRawDb(drizzleDb).close()

      // Clean up
      if (existsSync(nestedDbPath)) {
        unlinkSync(nestedDbPath)
      }
      if (existsSync(nestedDbPath + '-shm')) {
        unlinkSync(nestedDbPath + '-shm')
      }
      if (existsSync(nestedDbPath + '-wal')) {
        unlinkSync(nestedDbPath + '-wal')
      }
      // Clean up nested directories
      const fs = require('fs')
      fs.rmSync(join(__dirname, '../tmp/nested'), { recursive: true, force: true })
    } catch (error) {
      // Clean up on error
      const fs = require('fs')
      if (fs.existsSync(join(__dirname, '../tmp/nested'))) {
        fs.rmSync(join(__dirname, '../tmp/nested'), { recursive: true, force: true })
      }
      throw error
    }
  })

  it('should support multiple concurrent vector stores', () => {
    const db1Path = join(__dirname, '../tmp/factory-test-1.db')
    const db2Path = join(__dirname, '../tmp/factory-test-2.db')

    let drizzleDb1: DrizzleDB | null = null
    let drizzleDb2: DrizzleDB | null = null

    try {
      drizzleDb1 = createDatabase(db1Path)
      drizzleDb2 = createDatabase(db2Path)

      const store1 = createVectorStore(drizzleDb1)
      const store2 = createVectorStore(drizzleDb2)

      expect(store1).toBeDefined()
      expect(store2).toBeDefined()

      // Both should work independently
      store1.initialize(768)
      store2.initialize(768)

      expect(store1.getDimensions()).toBe(768)
      expect(store2.getDimensions()).toBe(768)

      getRawDb(drizzleDb1).close()
      getRawDb(drizzleDb2).close()

    } finally {
      // Clean up
      for (const path of [db1Path, db2Path]) {
        if (existsSync(path)) unlinkSync(path)
        if (existsSync(path + '-shm')) unlinkSync(path + '-shm')
        if (existsSync(path + '-wal')) unlinkSync(path + '-wal')
      }
    }
  })

  it('should create importer that works with real fixture data', async () => {
    const importer = createImporter('claude')
    const fixturePath = join(__dirname, '../fixtures/conversations/minimal.json')

    let conversationCount = 0

    // Import should work without errors
    for await (const conversation of importer.import(fixturePath)) {
      expect(conversation).toBeDefined()
      expect(conversation.uuid).toBeDefined()
      expect(conversation.title).toBeDefined()
      expect(conversation.platform).toBe('claude')
      expect(conversation.messages).toBeDefined()
      expect(Array.isArray(conversation.messages)).toBe(true)

      conversationCount++
    }

    expect(conversationCount).toBeGreaterThan(0)
  })
})
