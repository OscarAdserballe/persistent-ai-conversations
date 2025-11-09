import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { unlinkSync, existsSync } from 'fs'
import { join } from 'path'
import { createDatabase, closeDatabase } from '../../src/db/database'
import { SqliteVectorStore } from '../../src/db/vector-store'
import { SemanticSearch } from '../../src/search/semantic'
import { MockEmbeddingModel } from '../mocks/embedding-model'
import Database from 'better-sqlite3'

describe('Search Pipeline Integration', () => {
  const testDbPath = join(__dirname, '../tmp/search-integration-test.db')

  let db: Database.Database
  let vectorStore: SqliteVectorStore
  let embedder: MockEmbeddingModel
  let searchEngine: SemanticSearch

  beforeEach(() => {
    // Clean up any existing test database
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath)
    }

    // Create fresh database
    db = createDatabase(testDbPath)

    // Create mock embedder (deterministic embeddings)
    embedder = new MockEmbeddingModel()

    // Create vector store and initialize with embedder dimensions
    vectorStore = new SqliteVectorStore(db)
    vectorStore.initialize(embedder.dimensions)

    // Create search engine
    searchEngine = new SemanticSearch(embedder, vectorStore, db)
  })

  afterEach(() => {
    closeDatabase(db)
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath)
    }
  })

  it('should embed and store messages, then search', async () => {
    const convUuid = 'test-conv-1'
    const now = new Date().toISOString()

    // Insert test conversation
    db.prepare(`
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(convUuid, 'Test Conversation', now, now, 'claude', 3)

    // Insert messages with embeddings
    const messages = [
      { uuid: 'msg-1', text: 'What is TypeScript?', sender: 'human', index: 0 },
      { uuid: 'msg-2', text: 'TypeScript is a typed superset of JavaScript.', sender: 'assistant', index: 1 },
      { uuid: 'msg-3', text: 'Tell me about Python', sender: 'human', index: 2 }
    ]

    for (const msg of messages) {
      // Insert message
      db.prepare(`
        INSERT INTO messages (uuid, conversation_uuid, conversation_index, sender, text, created_at, chunk_count)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(msg.uuid, convUuid, msg.index, msg.sender, msg.text, now, 1)

      // Generate and store embedding in chunk
      const embedding = await embedder.embed(msg.text)
      db.prepare(`
        INSERT INTO message_chunks (message_uuid, chunk_index, text, char_count, embedding)
        VALUES (?, ?, ?, ?, ?)
      `).run(msg.uuid, 0, msg.text, msg.text.length, Buffer.from(embedding.buffer))
    }

    // Search for TypeScript-related messages
    const results = await searchEngine.search('TypeScript programming', { limit: 10 })

    expect(results.length).toBeGreaterThan(0)

    // The top result should be about TypeScript
    const topResult = results[0]
    expect(topResult.message.text).toContain('TypeScript')
    expect(topResult.score).toBeGreaterThan(0)
  })

  it('should enrich results with conversation context', async () => {
    const convUuid = 'test-conv-2'
    const now = new Date().toISOString()

    // Insert conversation
    db.prepare(`
      INSERT INTO conversations (uuid, name, summary, created_at, updated_at, platform, message_count)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(convUuid, 'Multi-turn Conversation', 'A conversation about programming', now, now, 'claude', 5)

    // Insert multiple messages in sequence
    const messages = [
      { uuid: 'msg-1', text: 'Hello', sender: 'human', index: 0 },
      { uuid: 'msg-2', text: 'Hi there!', sender: 'assistant', index: 1 },
      { uuid: 'msg-3', text: 'What is React?', sender: 'human', index: 2 },
      { uuid: 'msg-4', text: 'React is a JavaScript library for building user interfaces.', sender: 'assistant', index: 3 },
      { uuid: 'msg-5', text: 'Thanks!', sender: 'human', index: 4 }
    ]

    for (const msg of messages) {
      db.prepare(`
        INSERT INTO messages (uuid, conversation_uuid, conversation_index, sender, text, created_at, chunk_count)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(msg.uuid, convUuid, msg.index, msg.sender, msg.text, now, 1)

      const embedding = await embedder.embed(msg.text)
      db.prepare(`
        INSERT INTO message_chunks (message_uuid, chunk_index, text, char_count, embedding)
        VALUES (?, ?, ?, ?, ?)
      `).run(msg.uuid, 0, msg.text, msg.text.length, Buffer.from(embedding.buffer))
    }

    // Search for the React message
    const results = await searchEngine.search('React library', { limit: 5 })

    expect(results.length).toBeGreaterThan(0)

    const topResult = results[0]

    // Should have conversation metadata
    expect(topResult.conversation.uuid).toBe(convUuid)
    expect(topResult.conversation.title).toBe('Multi-turn Conversation')
    expect(topResult.conversation.summary).toBe('A conversation about programming')

    // Should have context messages
    // The React answer is at index 3, so we should have 2 previous messages
    expect(topResult.previousMessages.length).toBeGreaterThan(0)

    // And 1 next message
    expect(topResult.nextMessages.length).toBeGreaterThan(0)
  })

  it('should filter by sender', async () => {
    const convUuid = 'test-conv-3'
    const now = new Date().toISOString()

    // Insert conversation
    db.prepare(`
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(convUuid, 'Test Conversation', now, now, 'claude', 4)

    // Insert messages with different senders
    const messages = [
      { uuid: 'msg-1', text: 'Python is great for data science', sender: 'human', index: 0 },
      { uuid: 'msg-2', text: 'Indeed, Python has excellent libraries', sender: 'assistant', index: 1 },
      { uuid: 'msg-3', text: 'Python is my favorite language', sender: 'human', index: 2 },
      { uuid: 'msg-4', text: 'Python is very versatile', sender: 'assistant', index: 3 }
    ]

    for (const msg of messages) {
      db.prepare(`
        INSERT INTO messages (uuid, conversation_uuid, conversation_index, sender, text, created_at, chunk_count)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(msg.uuid, convUuid, msg.index, msg.sender, msg.text, now, 1)

      const embedding = await embedder.embed(msg.text)
      db.prepare(`
        INSERT INTO message_chunks (message_uuid, chunk_index, text, char_count, embedding)
        VALUES (?, ?, ?, ?, ?)
      `).run(msg.uuid, 0, msg.text, msg.text.length, Buffer.from(embedding.buffer))
    }

    // Search only for human messages
    const humanResults = await searchEngine.search('Python', {
      sender: 'human',
      limit: 10
    })

    // All results should be from human
    for (const result of humanResults) {
      expect(result.message.sender).toBe('human')
    }

    // Search only for assistant messages
    const assistantResults = await searchEngine.search('Python', {
      sender: 'assistant',
      limit: 10
    })

    // All results should be from assistant
    for (const result of assistantResults) {
      expect(result.message.sender).toBe('assistant')
    }
  })

  it('should filter by date range', async () => {
    const convUuid = 'test-conv-4'

    // Create dates at different times
    const oldDate = new Date('2023-01-01T00:00:00Z')
    const recentDate = new Date('2024-06-01T00:00:00Z')

    // Insert conversation
    db.prepare(`
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(convUuid, 'Test Conversation', oldDate.toISOString(), oldDate.toISOString(), 'claude', 2)

    // Insert old message
    const oldText = 'Old message about databases'
    db.prepare(`
      INSERT INTO messages (uuid, conversation_uuid, conversation_index, sender, text, created_at, chunk_count)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('msg-old', convUuid, 0, 'human', oldText, oldDate.toISOString(), 1)
    const oldEmbedding = await embedder.embed(oldText)
    db.prepare(`
      INSERT INTO message_chunks (message_uuid, chunk_index, text, char_count, embedding)
      VALUES (?, ?, ?, ?, ?)
    `).run('msg-old', 0, oldText, oldText.length, Buffer.from(oldEmbedding.buffer))

    // Insert recent message
    const recentText = 'Recent message about databases'
    db.prepare(`
      INSERT INTO messages (uuid, conversation_uuid, conversation_index, sender, text, created_at, chunk_count)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('msg-recent', convUuid, 1, 'human', recentText, recentDate.toISOString(), 1)
    const recentEmbedding = await embedder.embed(recentText)
    db.prepare(`
      INSERT INTO message_chunks (message_uuid, chunk_index, text, char_count, embedding)
      VALUES (?, ?, ?, ?, ?)
    `).run('msg-recent', 0, recentText, recentText.length, Buffer.from(recentEmbedding.buffer))

    // Search with date filter for recent messages only
    const results = await searchEngine.search('databases', {
      dateRange: {
        start: new Date('2024-01-01T00:00:00Z'),
        end: new Date('2024-12-31T23:59:59Z')
      },
      limit: 10
    })

    // Should only get the recent message
    expect(results.length).toBeGreaterThan(0)
    for (const result of results) {
      const createdAt = new Date(result.message.createdAt)
      expect(createdAt.getFullYear()).toBe(2024)
    }
  })

  it('should filter by conversation UUIDs', async () => {
    const conv1Uuid = 'test-conv-5a'
    const conv2Uuid = 'test-conv-5b'
    const now = new Date().toISOString()

    // Insert two conversations
    db.prepare(`
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(conv1Uuid, 'Conversation 1', now, now, 'claude', 1)

    db.prepare(`
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(conv2Uuid, 'Conversation 2', now, now, 'claude', 1)

    // Insert messages in both conversations
    const text1 = 'JavaScript is versatile'
    db.prepare(`
      INSERT INTO messages (uuid, conversation_uuid, conversation_index, sender, text, created_at, chunk_count)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('msg-conv1', conv1Uuid, 0, 'human', text1, now, 1)
    const emb1 = await embedder.embed(text1)
    db.prepare(`
      INSERT INTO message_chunks (message_uuid, chunk_index, text, char_count, embedding)
      VALUES (?, ?, ?, ?, ?)
    `).run('msg-conv1', 0, text1, text1.length, Buffer.from(emb1.buffer))

    const text2 = 'JavaScript is powerful'
    db.prepare(`
      INSERT INTO messages (uuid, conversation_uuid, conversation_index, sender, text, created_at, chunk_count)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('msg-conv2', conv2Uuid, 0, 'human', text2, now, 1)
    const emb2 = await embedder.embed(text2)
    db.prepare(`
      INSERT INTO message_chunks (message_uuid, chunk_index, text, char_count, embedding)
      VALUES (?, ?, ?, ?, ?)
    `).run('msg-conv2', 0, text2, text2.length, Buffer.from(emb2.buffer))

    // Search only in conversation 1
    const results = await searchEngine.search('JavaScript', {
      conversationUuids: [conv1Uuid],
      limit: 10
    })

    // Should only get results from conversation 1
    expect(results.length).toBeGreaterThan(0)
    for (const result of results) {
      expect(result.conversation.uuid).toBe(conv1Uuid)
    }
  })

  it('should handle empty search results gracefully', async () => {
    // Search with no messages in database
    const results = await searchEngine.search('nonexistent topic', { limit: 10 })

    expect(results).toEqual([])
  })

  it('should limit search results correctly', async () => {
    const convUuid = 'test-conv-6'
    const now = new Date().toISOString()

    // Insert conversation
    db.prepare(`
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(convUuid, 'Test Conversation', now, now, 'claude', 10)

    // Insert 10 similar messages
    for (let i = 0; i < 10; i++) {
      const msgUuid = `msg-${i}`
      const text = `Message ${i} about artificial intelligence and machine learning`

      db.prepare(`
        INSERT INTO messages (uuid, conversation_uuid, conversation_index, sender, text, created_at, chunk_count)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(msgUuid, convUuid, i, 'human', text, now, 1)

      const embedding = await embedder.embed(text)
      db.prepare(`
        INSERT INTO message_chunks (message_uuid, chunk_index, text, char_count, embedding)
        VALUES (?, ?, ?, ?, ?)
      `).run(msgUuid, 0, text, text.length, Buffer.from(embedding.buffer))
    }

    // Search with limit of 3
    const results = await searchEngine.search('artificial intelligence', { limit: 3 })

    expect(results.length).toBeLessThanOrEqual(3)
  })

  it('should return results sorted by relevance', async () => {
    const convUuid = 'test-conv-7'
    const now = new Date().toISOString()

    // Insert conversation
    db.prepare(`
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(convUuid, 'Test Conversation', now, now, 'claude', 3)

    // Insert messages with varying relevance to "TypeScript"
    const messages = [
      { uuid: 'msg-exact', text: 'TypeScript is a programming language', sender: 'human', index: 0 },
      { uuid: 'msg-related', text: 'JavaScript and TypeScript are related', sender: 'human', index: 1 },
      { uuid: 'msg-unrelated', text: 'Python is also a programming language', sender: 'human', index: 2 }
    ]

    for (const msg of messages) {
      db.prepare(`
        INSERT INTO messages (uuid, conversation_uuid, conversation_index, sender, text, created_at, chunk_count)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(msg.uuid, convUuid, msg.index, msg.sender, msg.text, now, 1)

      const embedding = await embedder.embed(msg.text)
      db.prepare(`
        INSERT INTO message_chunks (message_uuid, chunk_index, text, char_count, embedding)
        VALUES (?, ?, ?, ?, ?)
      `).run(msg.uuid, 0, msg.text, msg.text.length, Buffer.from(embedding.buffer))
    }

    // Search for TypeScript
    const results = await searchEngine.search('TypeScript', { limit: 10 })

    expect(results.length).toBeGreaterThan(0)

    // Scores should be in descending order
    for (let i = 0; i < results.length - 1; i++) {
      expect(results[i].score).toBeGreaterThanOrEqual(results[i + 1].score)
    }

    // Top result should be the most relevant (exact match)
    expect(results[0].message.text).toContain('TypeScript')
  })
})
