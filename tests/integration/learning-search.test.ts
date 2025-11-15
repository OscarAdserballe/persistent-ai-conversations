import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { unlinkSync, existsSync } from 'fs'
import { join } from 'path'
import { createDatabase, closeDatabase } from '../../src/db/database'
import { SqliteVectorStore } from '../../src/db/vector-store'
import { LearningSearchImpl } from '../../src/services/learning-search'
import { MockEmbeddingModel } from '../mocks'
import Database from 'better-sqlite3'

describe('Learning Search Pipeline', () => {
  const testDbPath = join(__dirname, '../tmp/learning-search-integration-test.db')

  let db: Database.Database
  let vectorStore: SqliteVectorStore
  let embedder: MockEmbeddingModel
  let search: LearningSearchImpl

  beforeEach(() => {
    // Clean up any existing test database
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath)
    }

    // Create fresh database
    db = createDatabase(testDbPath)

    // Create mock embedder
    embedder = new MockEmbeddingModel()

    // Create vector store and initialize
    vectorStore = new SqliteVectorStore(db)
    vectorStore.initialize(embedder.dimensions)

    // Create search engine
    search = new LearningSearchImpl(embedder, vectorStore, db)
  })

  afterEach(() => {
    closeDatabase(db)
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath)
    }
  })

  it('should search and return learnings with metadata', async () => {
    const now = new Date().toISOString()

    // Insert test conversation
    db.prepare(`
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES ('conv-1', 'TypeScript Tutorial', '${now}', '${now}', 'claude', 0)
    `).run()

    // Insert categories
    db.prepare(`
      INSERT INTO learning_categories (category_id, name, created_at)
      VALUES
        ('cat-1', 'programming', '${now}'),
        ('cat-2', 'typescript', '${now}')
    `).run()

    // Insert learning with embedding
    const learningText = 'TypeScript adds static typing'
    const embedding = await embedder.embed(learningText)

    db.prepare(`
      INSERT INTO learnings (learning_id, title, content, created_at, embedding)
      VALUES ('learn-1', 'TypeScript Intro', '${learningText}', '${now}', ?)
    `).run(Buffer.from(embedding.buffer))

    // Assign categories
    db.prepare(`
      INSERT INTO learning_category_assignments (learning_id, category_id)
      VALUES
        ('learn-1', 'cat-1'),
        ('learn-1', 'cat-2')
    `).run()

    // Link to source
    db.prepare(`
      INSERT INTO learning_sources (learning_id, conversation_uuid)
      VALUES ('learn-1', 'conv-1')
    `).run()

    // Search
    const results = await search.search('TypeScript', { limit: 10 })

    expect(results.length).toBeGreaterThan(0)
    const result = results[0]

    // Verify learning data
    expect(result.learning.learningId).toBe('learn-1')
    expect(result.learning.title).toBe('TypeScript Intro')
    expect(result.learning.content).toContain('TypeScript')

    // Verify categories
    expect(result.learning.categories.length).toBe(2)
    const categoryNames = result.learning.categories.map(c => c.name).sort()
    expect(categoryNames).toEqual(['programming', 'typescript'])

    // Verify sources
    expect(result.sourceConversations.length).toBe(1)
    expect(result.sourceConversations[0].uuid).toBe('conv-1')
    expect(result.sourceConversations[0].title).toBe('TypeScript Tutorial')

    // Verify score
    expect(result.score).toBeGreaterThan(0)
  })

  it('should filter by date range', async () => {
    // Insert learnings at different dates
    const oldDate = new Date('2023-01-01T00:00:00Z')
    const recentDate = new Date('2024-06-01T00:00:00Z')

    // Insert conversation
    db.prepare(`
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES ('conv-1', 'Test', '${oldDate.toISOString()}', '${oldDate.toISOString()}', 'claude', 0)
    `).run()

    // Insert old learning
    const oldEmbedding = await embedder.embed('old content')
    db.prepare(`
      INSERT INTO learnings (learning_id, title, content, created_at, embedding)
      VALUES ('learn-old', 'Old Learning', 'old content', '${oldDate.toISOString()}', ?)
    `).run(Buffer.from(oldEmbedding.buffer))

    db.prepare(`
      INSERT INTO learning_sources (learning_id, conversation_uuid)
      VALUES ('learn-old', 'conv-1')
    `).run()

    // Insert recent learning
    const recentEmbedding = await embedder.embed('recent content')
    db.prepare(`
      INSERT INTO learnings (learning_id, title, content, created_at, embedding)
      VALUES ('learn-recent', 'Recent Learning', 'recent content', '${recentDate.toISOString()}', ?)
    `).run(Buffer.from(recentEmbedding.buffer))

    db.prepare(`
      INSERT INTO learning_sources (learning_id, conversation_uuid)
      VALUES ('learn-recent', 'conv-1')
    `).run()

    // Search with date filter
    const results = await search.search('content', {
      dateRange: {
        start: new Date('2024-01-01T00:00:00Z'),
        end: new Date('2024-12-31T23:59:59Z')
      },
      limit: 10
    })

    // Should only get recent learning
    expect(results.length).toBeGreaterThan(0)
    for (const result of results) {
      expect(result.learning.createdAt.getFullYear()).toBe(2024)
    }
  })

  it('should filter by category', async () => {
    const now = new Date().toISOString()

    // Insert conversation
    db.prepare(`
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES ('conv-1', 'Test', '${now}', '${now}', 'claude', 0)
    `).run()

    // Insert categories
    db.prepare(`
      INSERT INTO learning_categories (category_id, name, created_at)
      VALUES
        ('cat-typescript', 'typescript', '${now}'),
        ('cat-react', 'react', '${now}')
    `).run()

    // Insert TypeScript learning
    const tsEmbedding = await embedder.embed('TypeScript content')
    db.prepare(`
      INSERT INTO learnings (learning_id, title, content, created_at, embedding)
      VALUES ('learn-ts', 'TypeScript Learning', 'TypeScript content', '${now}', ?)
    `).run(Buffer.from(tsEmbedding.buffer))

    db.prepare(`
      INSERT INTO learning_category_assignments (learning_id, category_id)
      VALUES ('learn-ts', 'cat-typescript')
    `).run()

    db.prepare(`
      INSERT INTO learning_sources (learning_id, conversation_uuid)
      VALUES ('learn-ts', 'conv-1')
    `).run()

    // Insert React learning
    const reactEmbedding = await embedder.embed('React content')
    db.prepare(`
      INSERT INTO learnings (learning_id, title, content, created_at, embedding)
      VALUES ('learn-react', 'React Learning', 'React content', '${now}', ?)
    `).run(Buffer.from(reactEmbedding.buffer))

    db.prepare(`
      INSERT INTO learning_category_assignments (learning_id, category_id)
      VALUES ('learn-react', 'cat-react')
    `).run()

    db.prepare(`
      INSERT INTO learning_sources (learning_id, conversation_uuid)
      VALUES ('learn-react', 'conv-1')
    `).run()

    // Search with category filter
    const results = await search.search('content', {
      categoryNames: ['typescript'],
      limit: 10
    })

    // Should only get TypeScript learning
    expect(results.length).toBeGreaterThan(0)
    for (const result of results) {
      const hasTypescript = result.learning.categories.some(c => c.name === 'typescript')
      expect(hasTypescript).toBe(true)
    }
  })

  it('should filter by multiple categories (OR logic)', async () => {
    const now = new Date().toISOString()

    // Insert conversation
    db.prepare(`
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES ('conv-1', 'Test', '${now}', '${now}', 'claude', 0)
    `).run()

    // Insert categories
    db.prepare(`
      INSERT INTO learning_categories (category_id, name, created_at)
      VALUES
        ('cat-1', 'typescript', '${now}'),
        ('cat-2', 'react', '${now}'),
        ('cat-3', 'python', '${now}')
    `).run()

    // Insert learnings with different categories
    const learnings = [
      { id: 'learn-1', category: 'cat-1' },
      { id: 'learn-2', category: 'cat-2' },
      { id: 'learn-3', category: 'cat-3' }
    ]

    for (const learning of learnings) {
      const embedding = await embedder.embed(`content ${learning.id}`)

      db.prepare(`
        INSERT INTO learnings (learning_id, title, content, created_at, embedding)
        VALUES (?, ?, ?, '${now}', ?)
      `).run(learning.id, `Title ${learning.id}`, `content ${learning.id}`, Buffer.from(embedding.buffer))

      db.prepare(`
        INSERT INTO learning_category_assignments (learning_id, category_id)
        VALUES (?, ?)
      `).run(learning.id, learning.category)

      db.prepare(`
        INSERT INTO learning_sources (learning_id, conversation_uuid)
        VALUES (?, 'conv-1')
      `).run(learning.id)
    }

    // Search with multiple categories
    const results = await search.search('content', {
      categoryNames: ['typescript', 'react'],
      limit: 10
    })

    // Should get TypeScript and React learnings (not Python)
    expect(results.length).toBe(2)
    for (const result of results) {
      const categoryNames = result.learning.categories.map(c => c.name)
      const hasEither = categoryNames.includes('typescript') || categoryNames.includes('react')
      expect(hasEither).toBe(true)
    }
  })

  it('should preserve relevance ordering', async () => {
    const now = new Date().toISOString()

    // Insert conversation
    db.prepare(`
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES ('conv-1', 'Test', '${now}', '${now}', 'claude', 0)
    `).run()

    // Insert 5 learnings with varying similarity to "TypeScript"
    const learnings = [
      { id: 'learn-1', text: 'TypeScript is great' },           // Most relevant
      { id: 'learn-2', text: 'TypeScript and JavaScript' },     // Relevant
      { id: 'learn-3', text: 'JavaScript programming' },        // Less relevant
      { id: 'learn-4', text: 'Python is also good' },           // Least relevant
      { id: 'learn-5', text: 'TypeScript types' }               // Very relevant
    ]

    for (const learning of learnings) {
      const embedding = await embedder.embed(learning.text)

      db.prepare(`
        INSERT INTO learnings (learning_id, title, content, created_at, embedding)
        VALUES (?, ?, ?, '${now}', ?)
      `).run(learning.id, learning.text, learning.text, Buffer.from(embedding.buffer))

      db.prepare(`
        INSERT INTO learning_sources (learning_id, conversation_uuid)
        VALUES (?, 'conv-1')
      `).run(learning.id)
    }

    // Search
    const results = await search.search('TypeScript', { limit: 10 })

    expect(results.length).toBeGreaterThan(0)

    // Scores should be in descending order
    for (let i = 0; i < results.length - 1; i++) {
      expect(results[i].score).toBeGreaterThanOrEqual(results[i + 1].score)
    }
  })

  it('should handle empty results', async () => {
    // Database is empty
    const results = await search.search('nonexistent', { limit: 10 })

    expect(results).toEqual([])
  })

  it('should limit results correctly', async () => {
    const now = new Date().toISOString()

    // Insert conversation
    db.prepare(`
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES ('conv-1', 'Test', '${now}', '${now}', 'claude', 0)
    `).run()

    // Insert 10 similar learnings
    for (let i = 0; i < 10; i++) {
      const text = `Learning ${i} about programming`
      const embedding = await embedder.embed(text)

      db.prepare(`
        INSERT INTO learnings (learning_id, title, content, created_at, embedding)
        VALUES (?, ?, ?, '${now}', ?)
      `).run(`learn-${i}`, text, text, Buffer.from(embedding.buffer))

      db.prepare(`
        INSERT INTO learning_sources (learning_id, conversation_uuid)
        VALUES (?, 'conv-1')
      `).run(`learn-${i}`)
    }

    // Search with limit of 3
    const results = await search.search('programming', { limit: 3 })

    expect(results.length).toBeLessThanOrEqual(3)
  })

  it('should combine date and category filters', async () => {
    // Insert conversation
    db.prepare(`
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES ('conv-1', 'Test', datetime('now'), datetime('now'), 'claude', 0)
    `).run()

    // Insert categories
    db.prepare(`
      INSERT INTO learning_categories (category_id, name, created_at)
      VALUES
        ('cat-1', 'typescript', datetime('now')),
        ('cat-2', 'python', datetime('now'))
    `).run()

    // Insert old TypeScript learning
    const oldDate = new Date('2023-01-01')
    const oldEmbedding = await embedder.embed('old TypeScript')
    db.prepare(`
      INSERT INTO learnings (learning_id, title, content, created_at, embedding)
      VALUES ('learn-old-ts', 'Old TS', 'old TypeScript', ?, ?)
    `).run(oldDate.toISOString(), Buffer.from(oldEmbedding.buffer))

    db.prepare(`
      INSERT INTO learning_category_assignments (learning_id, category_id)
      VALUES ('learn-old-ts', 'cat-1')
    `).run()

    db.prepare(`
      INSERT INTO learning_sources (learning_id, conversation_uuid)
      VALUES ('learn-old-ts', 'conv-1')
    `).run()

    // Insert recent TypeScript learning
    const recentDate = new Date('2024-06-01')
    const recentEmbedding = await embedder.embed('recent TypeScript')
    db.prepare(`
      INSERT INTO learnings (learning_id, title, content, created_at, embedding)
      VALUES ('learn-recent-ts', 'Recent TS', 'recent TypeScript', ?, ?)
    `).run(recentDate.toISOString(), Buffer.from(recentEmbedding.buffer))

    db.prepare(`
      INSERT INTO learning_category_assignments (learning_id, category_id)
      VALUES ('learn-recent-ts', 'cat-1')
    `).run()

    db.prepare(`
      INSERT INTO learning_sources (learning_id, conversation_uuid)
      VALUES ('learn-recent-ts', 'conv-1')
    `).run()

    // Insert recent Python learning
    const pythonEmbedding = await embedder.embed('recent Python')
    db.prepare(`
      INSERT INTO learnings (learning_id, title, content, created_at, embedding)
      VALUES ('learn-recent-py', 'Recent Py', 'recent Python', ?, ?)
    `).run(recentDate.toISOString(), Buffer.from(pythonEmbedding.buffer))

    db.prepare(`
      INSERT INTO learning_category_assignments (learning_id, category_id)
      VALUES ('learn-recent-py', 'cat-2')
    `).run()

    db.prepare(`
      INSERT INTO learning_sources (learning_id, conversation_uuid)
      VALUES ('learn-recent-py', 'conv-1')
    `).run()

    // Search with both filters
    const results = await search.search('programming', {
      dateRange: {
        start: new Date('2024-01-01'),
        end: new Date('2024-12-31')
      },
      categoryNames: ['typescript'],
      limit: 10
    })

    // Should only get recent TypeScript learning
    expect(results.length).toBe(1)
    expect(results[0].learning.learningId).toBe('learn-recent-ts')
  })

  it('should enrich with source conversations', async () => {
    const now = new Date().toISOString()

    // Insert conversation with metadata
    db.prepare(`
      INSERT INTO conversations (uuid, name, summary, created_at, updated_at, platform, message_count)
      VALUES ('conv-1', 'TypeScript Tutorial', 'A detailed tutorial', '${now}', '${now}', 'claude', 5)
    `).run()

    // Insert learning
    const embedding = await embedder.embed('TypeScript content')
    db.prepare(`
      INSERT INTO learnings (learning_id, title, content, created_at, embedding)
      VALUES ('learn-1', 'TypeScript', 'TypeScript content', '${now}', ?)
    `).run(Buffer.from(embedding.buffer))

    // Link to conversation
    db.prepare(`
      INSERT INTO learning_sources (learning_id, conversation_uuid)
      VALUES ('learn-1', 'conv-1')
    `).run()

    // Search
    const results = await search.search('TypeScript', { limit: 10 })

    expect(results.length).toBeGreaterThan(0)

    // Verify source conversation enrichment
    const source = results[0].sourceConversations[0]
    expect(source.uuid).toBe('conv-1')
    expect(source.title).toBe('TypeScript Tutorial')
    expect(source.createdAt).toBeInstanceOf(Date)
  })

  it('should handle learnings with no categories', async () => {
    const now = new Date().toISOString()

    // Insert conversation
    db.prepare(`
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES ('conv-1', 'Test', '${now}', '${now}', 'claude', 0)
    `).run()

    // Insert learning without categories
    const embedding = await embedder.embed('uncategorized content')
    db.prepare(`
      INSERT INTO learnings (learning_id, title, content, created_at, embedding)
      VALUES ('learn-1', 'Uncategorized', 'uncategorized content', '${now}', ?)
    `).run(Buffer.from(embedding.buffer))

    db.prepare(`
      INSERT INTO learning_sources (learning_id, conversation_uuid)
      VALUES ('learn-1', 'conv-1')
    `).run()

    // Search
    const results = await search.search('content', { limit: 10 })

    expect(results.length).toBeGreaterThan(0)
    expect(results[0].learning.categories).toEqual([])
  })

  it('should handle large result sets efficiently', async () => {
    const now = new Date().toISOString()

    // Insert conversation
    db.prepare(`
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES ('conv-1', 'Test', '${now}', '${now}', 'claude', 0)
    `).run()

    // Insert 100 learnings
    for (let i = 0; i < 100; i++) {
      const text = `Learning ${i} about programming and software development`
      const embedding = await embedder.embed(text)

      db.prepare(`
        INSERT INTO learnings (learning_id, title, content, created_at, embedding)
        VALUES (?, ?, ?, '${now}', ?)
      `).run(`learn-${i}`, text, text, Buffer.from(embedding.buffer))

      db.prepare(`
        INSERT INTO learning_sources (learning_id, conversation_uuid)
        VALUES (?, 'conv-1')
      `).run(`learn-${i}`)
    }

    // Search with limit
    const startTime = Date.now()
    const results = await search.search('programming', { limit: 20 })
    const endTime = Date.now()

    expect(results.length).toBeLessThanOrEqual(20)

    // Should complete reasonably quickly (< 1 second for 100 learnings)
    expect(endTime - startTime).toBeLessThan(1000)
  })
})
