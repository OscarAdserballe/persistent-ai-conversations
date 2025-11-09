import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { SqliteVectorStore } from '../../../src/db/vector-store'
import { initializeSchema } from '../../../src/db/schema'
import { unlinkSync } from 'fs'
import { resolve } from 'path'

describe('SqliteVectorStore', () => {
  let db: Database.Database
  let vectorStore: SqliteVectorStore
  const dbPath = resolve(__dirname, '../../tmp/vector-store-test.db')

  beforeEach(() => {
    // Create fresh database
    db = new Database(dbPath)
    initializeSchema(db)
    vectorStore = new SqliteVectorStore(db)

    // Insert test messages
    db.prepare(`
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform)
      VALUES ('conv-1', 'Test', '2025-01-01', '2025-01-01', 'claude')
    `).run()

    db.prepare(`
      INSERT INTO messages (uuid, conversation_uuid, conversation_index, sender, text, created_at)
      VALUES
        ('msg-1', 'conv-1', 0, 'human', 'Hello', '2025-01-01'),
        ('msg-2', 'conv-1', 1, 'assistant', 'Hi there', '2025-01-01'),
        ('msg-3', 'conv-1', 2, 'human', 'How are you?', '2025-01-01')
    `).run()
  })

  afterEach(() => {
    db.close()
    try {
      unlinkSync(dbPath)
    } catch (e) {
      // Ignore if file doesn't exist
    }
  })

  describe('initialize', () => {
    it('should initialize with dimensions', () => {
      vectorStore.initialize(768)
      expect(vectorStore.getDimensions()).toBe(768)
    })

    it('should allow calling initialize multiple times with same dimensions', () => {
      vectorStore.initialize(768)
      vectorStore.initialize(768)
      expect(vectorStore.getDimensions()).toBe(768)
    })

    it('should throw if reinitializing with different dimensions', () => {
      vectorStore.initialize(768)
      expect(() => vectorStore.initialize(512)).toThrow(/Already initialized/)
    })
  })

  describe('search', () => {
    beforeEach(() => {
      vectorStore.initialize(3) // Use small dimensions for testing

      // Insert test message chunks directly (bypassing deprecated insert method)
      db.prepare('INSERT INTO message_chunks (message_uuid, chunk_index, text, char_count, embedding) VALUES (?, ?, ?, ?, ?)').run(
        'msg-1', 0, 'test1', 5, Buffer.from(new Float32Array([1, 0, 0]).buffer)
      )
      db.prepare('INSERT INTO message_chunks (message_uuid, chunk_index, text, char_count, embedding) VALUES (?, ?, ?, ?, ?)').run(
        'msg-2', 0, 'test2', 5, Buffer.from(new Float32Array([0, 1, 0]).buffer)
      )
      db.prepare('INSERT INTO message_chunks (message_uuid, chunk_index, text, char_count, embedding) VALUES (?, ?, ?, ?, ?)').run(
        'msg-3', 0, 'test3', 5, Buffer.from(new Float32Array([0, 0, 1]).buffer)
      )
    })

    it('should return empty array if no embeddings exist', () => {
      const store = new SqliteVectorStore(db)
      store.initialize(3)

      // Clear embeddings
      db.prepare('DELETE FROM message_chunks').run()

      const results = store.search(new Float32Array([1, 0, 0]), 10)
      expect(results).toEqual([])
    })

    it('should throw if not initialized', () => {
      const store = new SqliteVectorStore(db)
      expect(() => store.search(new Float32Array([1, 0, 0]), 10)).toThrow(/not initialized/)
    })

    it('should throw if query has wrong dimensions', () => {
      expect(() => vectorStore.search(new Float32Array([1, 0]), 10)).toThrow(/dimension mismatch/)
    })

    it('should return results sorted by similarity', () => {
      const query = new Float32Array([0.9, 0.1, 0]) // Close to msg-1
      const results = vectorStore.search(query, 3)

      expect(results).toHaveLength(3)
      expect(results[0].id).toBe('msg-1') // Most similar
      expect(results[0].score).toBeGreaterThan(results[1].score)
      expect(results[1].score).toBeGreaterThan(results[2].score)
    })

    it('should respect limit parameter', () => {
      const query = new Float32Array([1, 0, 0])
      const results = vectorStore.search(query, 2)

      expect(results).toHaveLength(2)
    })

    it('should return scores between 0 and 1', () => {
      const query = new Float32Array([1, 0, 0])
      const results = vectorStore.search(query, 3)

      for (const result of results) {
        expect(result.score).toBeGreaterThanOrEqual(0)
        expect(result.score).toBeLessThanOrEqual(1)
      }
    })

    it('should calculate cosine similarity correctly', () => {
      const query = new Float32Array([1, 0, 0])
      const results = vectorStore.search(query, 3)

      // Query is identical to msg-1, so score should be 1 (or very close due to float precision)
      expect(results[0].id).toBe('msg-1')
      expect(results[0].score).toBeCloseTo(1, 5)

      // Query is orthogonal to msg-2 and msg-3, so scores should be 0
      expect(results[1].score).toBeCloseTo(0, 5)
      expect(results[2].score).toBeCloseTo(0, 5)
    })
  })

  describe('getDimensions', () => {
    it('should return null before initialization', () => {
      expect(vectorStore.getDimensions()).toBeNull()
    })

    it('should return dimensions after initialization', () => {
      vectorStore.initialize(768)
      expect(vectorStore.getDimensions()).toBe(768)
    })
  })
})
