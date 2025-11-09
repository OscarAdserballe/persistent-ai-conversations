import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { SemanticSearch } from '../../../src/search/semantic'
import { MockEmbeddingModel, MockVectorStore } from '../../mocks'
import { initializeSchema } from '../../../src/db/schema'
import { unlinkSync } from 'fs'
import { resolve } from 'path'

describe('SemanticSearch', () => {
  let db: Database.Database
  let embedder: MockEmbeddingModel
  let vectorStore: MockVectorStore
  let search: SemanticSearch
  const dbPath = resolve(__dirname, '../../tmp/semantic-search-test.db')

  beforeEach(() => {
    // Create fresh database
    db = new Database(dbPath)
    initializeSchema(db)

    // Insert test data
    db.prepare(`
      INSERT INTO conversations (uuid, name, summary, created_at, updated_at, platform)
      VALUES ('conv-1', 'Test Conversation', 'A test', '2025-01-01', '2025-01-01', 'claude')
    `).run()

    db.prepare(`
      INSERT INTO messages (uuid, conversation_uuid, conversation_index, sender, text, created_at)
      VALUES
        ('msg-1', 'conv-1', 0, 'human', 'First message', '2025-01-01'),
        ('msg-2', 'conv-1', 1, 'assistant', 'Second message', '2025-01-02'),
        ('msg-3', 'conv-1', 2, 'human', 'Third message', '2025-01-03'),
        ('msg-4', 'conv-1', 3, 'assistant', 'Fourth message', '2025-01-04'),
        ('msg-5', 'conv-1', 4, 'human', 'Fifth message', '2025-01-05')
    `).run()

    // Create mocks
    embedder = new MockEmbeddingModel()
    vectorStore = new MockVectorStore()

    // Insert embeddings into vector store
    vectorStore.initialize(768)
    for (let i = 1; i <= 5; i++) {
      const embedding = new Float32Array(768).fill(i / 10)
      vectorStore.insert(`msg-${i}`, embedding)
    }

    // Create search engine
    search = new SemanticSearch(embedder, vectorStore, db)
  })

  afterEach(() => {
    db.close()
    try {
      unlinkSync(dbPath)
    } catch (e) {
      // Ignore if file doesn't exist
    }
  })

  describe('search', () => {
    it('should return search results', async () => {
      const results = await search.search('test query')

      expect(results).toBeDefined()
      expect(Array.isArray(results)).toBe(true)
    })

    it('should return results with message, conversation, and score', async () => {
      const results = await search.search('test query', { limit: 1 })

      expect(results.length).toBeGreaterThan(0)
      const result = results[0]

      expect(result.message).toBeDefined()
      expect(result.conversation).toBeDefined()
      expect(result.score).toBeDefined()
      expect(typeof result.score).toBe('number')
    })

    it('should include conversation metadata', async () => {
      const results = await search.search('test query', { limit: 1 })
      const result = results[0]

      expect(result.conversation.uuid).toBe('conv-1')
      expect(result.conversation.title).toBe('Test Conversation')
      expect(result.conversation.summary).toBe('A test')
      expect(result.conversation.platform).toBe('claude')
      expect(result.conversation.createdAt).toBeInstanceOf(Date)
    })

    it('should respect limit parameter', async () => {
      const results = await search.search('test query', { limit: 2 })
      expect(results.length).toBeLessThanOrEqual(2)
    })

    it('should return empty array if no results', async () => {
      // Clear all embeddings
      vectorStore.clear()

      const results = await search.search('test query')
      expect(results).toEqual([])
    })

    it('should embed the query', async () => {
      await search.search('test query')
      expect(embedder.callCount).toBeGreaterThan(0)
      expect(embedder.lastTexts).toContain('test query')
    })
  })

  describe('context enrichment', () => {
    it('should include previous messages', async () => {
      const results = await search.search('test query', { limit: 5 })

      // Find a message that's not at the start
      const middleResult = results.find(r => r.message.conversationIndex >= 2)

      if (middleResult) {
        expect(middleResult.previousMessages.length).toBeGreaterThan(0)
        expect(middleResult.previousMessages.length).toBeLessThanOrEqual(2)
      }
    })

    it('should include next messages', async () => {
      const results = await search.search('test query', { limit: 5 })

      // Find a message that's not at the end
      const middleResult = results.find(r => r.message.conversationIndex <= 3)

      if (middleResult) {
        expect(middleResult.nextMessages.length).toBeGreaterThan(0)
        expect(middleResult.nextMessages.length).toBeLessThanOrEqual(1)
      }
    })

    it('should have empty previous messages for first message', async () => {
      const results = await search.search('test query', { limit: 5 })

      const firstMessageResult = results.find(r => r.message.conversationIndex === 0)

      if (firstMessageResult) {
        expect(firstMessageResult.previousMessages).toEqual([])
      }
    })

    it('should have empty next messages for last message', async () => {
      const results = await search.search('test query', { limit: 5 })

      const lastMessageResult = results.find(r => r.message.conversationIndex === 4)

      if (lastMessageResult) {
        expect(lastMessageResult.nextMessages).toEqual([])
      }
    })

    it('should return messages in correct order', async () => {
      const results = await search.search('test query', { limit: 5 })
      const middleResult = results.find(r => r.message.conversationIndex === 2)

      if (middleResult) {
        // Previous messages should be in ascending order
        for (let i = 0; i < middleResult.previousMessages.length - 1; i++) {
          expect(middleResult.previousMessages[i].conversationIndex)
            .toBeLessThan(middleResult.previousMessages[i + 1].conversationIndex)
        }

        // Next messages should be in ascending order
        for (let i = 0; i < middleResult.nextMessages.length - 1; i++) {
          expect(middleResult.nextMessages[i].conversationIndex)
            .toBeLessThan(middleResult.nextMessages[i + 1].conversationIndex)
        }
      }
    })
  })

  describe('filters', () => {
    it('should filter by sender', async () => {
      const results = await search.search('test query', {
        sender: 'human',
        limit: 10
      })

      results.forEach(result => {
        expect(result.message.sender).toBe('human')
      })
    })

    it('should filter by date range', async () => {
      const results = await search.search('test query', {
        dateRange: {
          start: new Date('2025-01-02'),
          end: new Date('2025-01-04')
        },
        limit: 10
      })

      results.forEach(result => {
        expect(result.message.createdAt.getTime()).toBeGreaterThanOrEqual(
          new Date('2025-01-02').getTime()
        )
        expect(result.message.createdAt.getTime()).toBeLessThanOrEqual(
          new Date('2025-01-04').getTime()
        )
      })
    })

    it('should filter by conversation UUIDs', async () => {
      // Add another conversation
      db.prepare(`
        INSERT INTO conversations (uuid, name, created_at, updated_at, platform)
        VALUES ('conv-2', 'Other', '2025-01-01', '2025-01-01', 'claude')
      `).run()

      db.prepare(`
        INSERT INTO messages (uuid, conversation_uuid, conversation_index, sender, text, created_at)
        VALUES ('msg-6', 'conv-2', 0, 'human', 'Other message', '2025-01-01')
      `).run()

      const embedding = new Float32Array(768).fill(0.6)
      vectorStore.insert('msg-6', embedding)

      const results = await search.search('test query', {
        conversationUuids: ['conv-1'],
        limit: 10
      })

      results.forEach(result => {
        expect(result.conversation.uuid).toBe('conv-1')
      })
    })

    it('should combine multiple filters', async () => {
      const results = await search.search('test query', {
        sender: 'human',
        dateRange: {
          start: new Date('2025-01-03'),
          end: new Date('2025-01-05')
        },
        conversationUuids: ['conv-1'],
        limit: 10
      })

      results.forEach(result => {
        expect(result.message.sender).toBe('human')
        expect(result.message.createdAt.getTime()).toBeGreaterThanOrEqual(
          new Date('2025-01-03').getTime()
        )
        expect(result.conversation.uuid).toBe('conv-1')
      })
    })
  })
})
