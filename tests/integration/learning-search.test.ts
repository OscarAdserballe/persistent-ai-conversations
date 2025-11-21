import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { unlinkSync, existsSync } from 'fs'
import { join } from 'path'
import { createDatabase } from '../../src/factories'
import { getRawDb, type DrizzleDB } from '../../src/db/client'
import { SqliteVectorStore } from '../../src/db/vector-store'
import { LearningSearchImpl } from '../../src/services/learning-search'
import { MockEmbeddingModel } from '../../src/mocks'

describe('Learning Search Pipeline', () => {
  const testDbPath = join(__dirname, '../tmp/learning-search-integration-test.db')

  let drizzleDb: DrizzleDB
  let vectorStore: SqliteVectorStore
  let embedder: MockEmbeddingModel
  let search: LearningSearchImpl

  beforeEach(() => {
    // Clean up any existing test database
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath)
    }

    // Create fresh Drizzle database
    drizzleDb = createDatabase(testDbPath)

    // Create mock embedder
    embedder = new MockEmbeddingModel()

    // Create vector store and initialize
    vectorStore = new SqliteVectorStore(getRawDb(drizzleDb))
    vectorStore.initialize(embedder.dimensions)

    // Create search engine with DrizzleDB
    search = new LearningSearchImpl(embedder, vectorStore, drizzleDb)
  })

  afterEach(() => {
    getRawDb(drizzleDb).close()
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath)
    }
  })

  it('should search and return learnings with metadata', async () => {
    const now = new Date().toISOString()

    // Insert test conversation
    getRawDb(drizzleDb).prepare(`
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES ('conv-1', 'TypeScript Tutorial', '${now}', '${now}', 'claude', 0)
    `).run()

    // Insert learning with new schema
    const learningText = 'TypeScript adds static typing'
    const embedding = await embedder.embed(learningText)

    const abstraction = JSON.stringify({ concrete: 'Test concrete', pattern: 'Test pattern', principle: 'Test principle' })
    const understanding = JSON.stringify({ confidence: 7, canTeachIt: true, knownGaps: [] })
    const effort = JSON.stringify({ processingTime: '30min', cognitiveLoad: 'moderate' })
    const resonance = JSON.stringify({ intensity: 5, valence: 'positive' })
    const tags = JSON.stringify(['programming', 'typescript'])

    getRawDb(drizzleDb).prepare(`
      INSERT INTO learnings (
        learning_id, title, context, insight, why, implications, tags,
        abstraction, understanding, effort, resonance,
        conversation_uuid, embedding, created_at
      ) VALUES ('learn-1', 'TypeScript Intro', 'Context', '${learningText}', 'Why', 'Implications', ?, ?, ?, ?, ?, 'conv-1', ?, '${now}')
    `).run(tags, abstraction, understanding, effort, resonance, Buffer.from(embedding.buffer))

    // No more category assignments - tags are in JSON field
    // No more learning_sources table - conversation_uuid is in learnings table

    // Search
    const results = await search.search('TypeScript', { limit: 10 })

    expect(results.length).toBeGreaterThan(0)
    const result = results[0]

    // Verify learning data
    expect(result.learning.learningId).toBe('learn-1')
    expect(result.learning.title).toBe('TypeScript Intro')
    expect(result.learning.insight).toContain('TypeScript')

    // Verify tags (replaces categories)
    expect(result.learning.tags.length).toBe(2)
    const tagNames = result.learning.tags.sort()
    expect(tagNames).toEqual(['programming', 'typescript'])

    // Verify source (singular, not plural)
    expect(result.sourceConversation).toBeDefined()
    expect(result.sourceConversation?.uuid).toBe('conv-1')
    expect(result.sourceConversation?.title).toBe('TypeScript Tutorial')

    // Verify score
    expect(result.score).toBeGreaterThan(0)
  })

  it('should filter by date range', async () => {
    // Insert learnings at different dates
    const oldDate = new Date('2023-01-01T00:00:00Z')
    const recentDate = new Date('2024-06-01T00:00:00Z')

    // Insert conversation
    getRawDb(drizzleDb).prepare(`
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES ('conv-1', 'Test', '${oldDate.toISOString()}', '${oldDate.toISOString()}', 'claude', 0)
    `).run()

    // Common JSON fields
    const abstraction = JSON.stringify({ concrete: 'Test concrete', pattern: 'Test pattern', principle: 'Test principle' })
    const understanding = JSON.stringify({ confidence: 7, canTeachIt: true, knownGaps: [] })
    const effort = JSON.stringify({ processingTime: '30min', cognitiveLoad: 'moderate' })
    const resonance = JSON.stringify({ intensity: 5, valence: 'positive' })
    const tags = JSON.stringify(['test'])

    // Insert old learning - use simple text for testing
    const searchQuery = 'test query for date filtering'
    const oldText = searchQuery  // Use same text to ensure high similarity
    const oldEmbedding = await embedder.embed(oldText)
    getRawDb(drizzleDb).prepare(`
      INSERT INTO learnings (
        learning_id, title, context, insight, why, implications, tags,
        abstraction, understanding, effort, resonance,
        conversation_uuid, embedding, created_at
      ) VALUES ('learn-old', 'Old Learning', 'Context', ?, 'Why', 'Implications', ?, ?, ?, ?, ?, 'conv-1', ?, ?)
    `).run(oldText, tags, abstraction, understanding, effort, resonance, Buffer.from(oldEmbedding.buffer), oldDate.getTime())

    // Insert recent learning - use same text to ensure high similarity
    const recentText = searchQuery  // Use same text to ensure high similarity
    const recentEmbedding = await embedder.embed(recentText)
    getRawDb(drizzleDb).prepare(`
      INSERT INTO learnings (
        learning_id, title, context, insight, why, implications, tags,
        abstraction, understanding, effort, resonance,
        conversation_uuid, embedding, created_at
      ) VALUES ('learn-recent', 'Recent Learning', 'Context', ?, 'Why', 'Implications', ?, ?, ?, ?, ?, 'conv-1', ?, ?)
    `).run(recentText, tags, abstraction, understanding, effort, resonance, Buffer.from(recentEmbedding.buffer), recentDate.getTime())

    // Search with date filter - use same query to ensure embeddings match
    const results = await search.search(searchQuery, {
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

  it('should filter by tags', async () => {
    const now = new Date().toISOString()

    // Insert conversation
    getRawDb(drizzleDb).prepare(`
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES ('conv-1', 'Test', '${now}', '${now}', 'claude', 0)
    `).run()

    // Common JSON fields
    const abstraction = JSON.stringify({ concrete: 'Test concrete', pattern: 'Test pattern', principle: 'Test principle' })
    const understanding = JSON.stringify({ confidence: 7, canTeachIt: true, knownGaps: [] })
    const effort = JSON.stringify({ processingTime: '30min', cognitiveLoad: 'moderate' })
    const resonance = JSON.stringify({ intensity: 5, valence: 'positive' })

    // Insert TypeScript learning
    const tsTags = JSON.stringify(['typescript', 'programming'])
    const tsEmbedding = await embedder.embed('TypeScript content')
    getRawDb(drizzleDb).prepare(`
      INSERT INTO learnings (
        learning_id, title, context, insight, why, implications, tags,
        abstraction, understanding, effort, resonance,
        conversation_uuid, embedding, created_at
      ) VALUES ('learn-ts', 'TypeScript Learning', 'Context', 'TypeScript content', 'Why', 'Implications', ?, ?, ?, ?, ?, 'conv-1', ?, '${now}')
    `).run(tsTags, abstraction, understanding, effort, resonance, Buffer.from(tsEmbedding.buffer))

    // Insert React learning
    const reactTags = JSON.stringify(['react', 'frontend'])
    const reactEmbedding = await embedder.embed('React content')
    getRawDb(drizzleDb).prepare(`
      INSERT INTO learnings (
        learning_id, title, context, insight, why, implications, tags,
        abstraction, understanding, effort, resonance,
        conversation_uuid, embedding, created_at
      ) VALUES ('learn-react', 'React Learning', 'Context', 'React content', 'Why', 'Implications', ?, ?, ?, ?, ?, 'conv-1', ?, '${now}')
    `).run(reactTags, abstraction, understanding, effort, resonance, Buffer.from(reactEmbedding.buffer))

    // Search with tag filter
    const results = await search.search('content', {
      tags: ['typescript'],
      limit: 10
    })

    // Should only get TypeScript learning
    expect(results.length).toBeGreaterThan(0)
    for (const result of results) {
      const hasTypescript = result.learning.tags.some(t => t === 'typescript')
      expect(hasTypescript).toBe(true)
    }
  })

  it('should filter by multiple tags (OR logic)', async () => {
    const now = new Date().toISOString()

    // Insert conversation
    getRawDb(drizzleDb).prepare(`
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES ('conv-1', 'Test', '${now}', '${now}', 'claude', 0)
    `).run()

    // Common JSON fields
    const abstraction = JSON.stringify({ concrete: 'Test concrete', pattern: 'Test pattern', principle: 'Test principle' })
    const understanding = JSON.stringify({ confidence: 7, canTeachIt: true, knownGaps: [] })
    const effort = JSON.stringify({ processingTime: '30min', cognitiveLoad: 'moderate' })
    const resonance = JSON.stringify({ intensity: 5, valence: 'positive' })

    // Insert learnings with different tags
    const learnings = [
      { id: 'learn-1', tags: ['typescript'] },
      { id: 'learn-2', tags: ['react'] },
      { id: 'learn-3', tags: ['python'] }
    ]

    for (const learning of learnings) {
      const embedding = await embedder.embed(`content ${learning.id}`)
      const tags = JSON.stringify(learning.tags)

      getRawDb(drizzleDb).prepare(`
        INSERT INTO learnings (
          learning_id, title, context, insight, why, implications, tags,
          abstraction, understanding, effort, resonance,
          conversation_uuid, embedding, created_at
        ) VALUES (?, ?, 'Context', ?, 'Why', 'Implications', ?, ?, ?, ?, ?, 'conv-1', ?, '${now}')
      `).run(learning.id, `Title ${learning.id}`, `content ${learning.id}`, tags, abstraction, understanding, effort, resonance, Buffer.from(embedding.buffer))
    }

    // Search with multiple tags
    const results = await search.search('content', {
      tags: ['typescript', 'react'],
      limit: 10
    })

    // Should get TypeScript and React learnings (not Python)
    expect(results.length).toBe(2)
    for (const result of results) {
      const tagNames = result.learning.tags
      const hasEither = tagNames.includes('typescript') || tagNames.includes('react')
      expect(hasEither).toBe(true)
    }
  })

  it('should preserve relevance ordering', async () => {
    const now = new Date().toISOString()

    // Insert conversation
    getRawDb(drizzleDb).prepare(`
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES ('conv-1', 'Test', '${now}', '${now}', 'claude', 0)
    `).run()

    // Common JSON fields
    const abstraction = JSON.stringify({ concrete: 'Test concrete', pattern: 'Test pattern', principle: 'Test principle' })
    const understanding = JSON.stringify({ confidence: 7, canTeachIt: true, knownGaps: [] })
    const effort = JSON.stringify({ processingTime: '30min', cognitiveLoad: 'moderate' })
    const resonance = JSON.stringify({ intensity: 5, valence: 'positive' })
    const tags = JSON.stringify(['test'])

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

      getRawDb(drizzleDb).prepare(`
        INSERT INTO learnings (
          learning_id, title, context, insight, why, implications, tags,
          abstraction, understanding, effort, resonance,
          conversation_uuid, embedding, created_at
        ) VALUES (?, ?, 'Context', ?, 'Why', 'Implications', ?, ?, ?, ?, ?, 'conv-1', ?, '${now}')
      `).run(learning.id, learning.text, learning.text, tags, abstraction, understanding, effort, resonance, Buffer.from(embedding.buffer))
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
    getRawDb(drizzleDb).prepare(`
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES ('conv-1', 'Test', '${now}', '${now}', 'claude', 0)
    `).run()

    // Common JSON fields
    const abstraction = JSON.stringify({ concrete: 'Test concrete', pattern: 'Test pattern', principle: 'Test principle' })
    const understanding = JSON.stringify({ confidence: 7, canTeachIt: true, knownGaps: [] })
    const effort = JSON.stringify({ processingTime: '30min', cognitiveLoad: 'moderate' })
    const resonance = JSON.stringify({ intensity: 5, valence: 'positive' })
    const tags = JSON.stringify(['test'])

    // Insert 10 similar learnings
    for (let i = 0; i < 10; i++) {
      const text = `Learning ${i} about programming`
      const embedding = await embedder.embed(text)

      getRawDb(drizzleDb).prepare(`
        INSERT INTO learnings (
          learning_id, title, context, insight, why, implications, tags,
          abstraction, understanding, effort, resonance,
          conversation_uuid, embedding, created_at
        ) VALUES (?, ?, 'Context', ?, 'Why', 'Implications', ?, ?, ?, ?, ?, 'conv-1', ?, '${now}')
      `).run(`learn-${i}`, text, text, tags, abstraction, understanding, effort, resonance, Buffer.from(embedding.buffer))
    }

    // Search with limit of 3
    const results = await search.search('programming', { limit: 3 })

    expect(results.length).toBeLessThanOrEqual(3)
  })

  it('should combine date and tag filters', async () => {
    // Insert conversation
    getRawDb(drizzleDb).prepare(`
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES ('conv-1', 'Test', datetime('now'), datetime('now'), 'claude', 0)
    `).run()

    // Common JSON fields
    const abstraction = JSON.stringify({ concrete: 'Test concrete', pattern: 'Test pattern', principle: 'Test principle' })
    const understanding = JSON.stringify({ confidence: 7, canTeachIt: true, knownGaps: [] })
    const effort = JSON.stringify({ processingTime: '30min', cognitiveLoad: 'moderate' })
    const resonance = JSON.stringify({ intensity: 5, valence: 'positive' })

    // Use same text for all to ensure embeddings match the search
    const searchQuery = 'test query for filtering'

    // Insert old TypeScript learning
    const oldDate = new Date('2023-01-01')
    const oldTsText = searchQuery
    const oldEmbedding = await embedder.embed(oldTsText)
    const tsTags = JSON.stringify(['typescript'])
    getRawDb(drizzleDb).prepare(`
      INSERT INTO learnings (
        learning_id, title, context, insight, why, implications, tags,
        abstraction, understanding, effort, resonance,
        conversation_uuid, embedding, created_at
      ) VALUES ('learn-old-ts', 'Old TS', 'Context', ?, 'Why', 'Implications', ?, ?, ?, ?, ?, 'conv-1', ?, ?)
    `).run(oldTsText, tsTags, abstraction, understanding, effort, resonance, Buffer.from(oldEmbedding.buffer), oldDate.getTime())

    // Insert recent TypeScript learning
    const recentDate = new Date('2024-06-01')
    const recentTsText = searchQuery
    const recentEmbedding = await embedder.embed(recentTsText)
    getRawDb(drizzleDb).prepare(`
      INSERT INTO learnings (
        learning_id, title, context, insight, why, implications, tags,
        abstraction, understanding, effort, resonance,
        conversation_uuid, embedding, created_at
      ) VALUES ('learn-recent-ts', 'Recent TS', 'Context', ?, 'Why', 'Implications', ?, ?, ?, ?, ?, 'conv-1', ?, ?)
    `).run(recentTsText, tsTags, abstraction, understanding, effort, resonance, Buffer.from(recentEmbedding.buffer), recentDate.getTime())

    // Insert recent Python learning
    const pythonText = searchQuery
    const pythonEmbedding = await embedder.embed(pythonText)
    const pyTags = JSON.stringify(['python'])
    getRawDb(drizzleDb).prepare(`
      INSERT INTO learnings (
        learning_id, title, context, insight, why, implications, tags,
        abstraction, understanding, effort, resonance,
        conversation_uuid, embedding, created_at
      ) VALUES ('learn-recent-py', 'Recent Py', 'Context', ?, 'Why', 'Implications', ?, ?, ?, ?, ?, 'conv-1', ?, ?)
    `).run(pythonText, pyTags, abstraction, understanding, effort, resonance, Buffer.from(pythonEmbedding.buffer), recentDate.getTime())

    // Search with both filters
    const results = await search.search(searchQuery, {
      dateRange: {
        start: new Date('2024-01-01'),
        end: new Date('2024-12-31')
      },
      tags: ['typescript'],
      limit: 10
    })

    // Should only get recent TypeScript learning
    expect(results.length).toBe(1)
    expect(results[0].learning.learningId).toBe('learn-recent-ts')
  })

  it('should enrich with source conversations', async () => {
    const now = new Date().toISOString()

    // Insert conversation with metadata
    getRawDb(drizzleDb).prepare(`
      INSERT INTO conversations (uuid, name, summary, created_at, updated_at, platform, message_count)
      VALUES ('conv-1', 'TypeScript Tutorial', 'A detailed tutorial', '${now}', '${now}', 'claude', 5)
    `).run()

    // Common JSON fields
    const abstraction = JSON.stringify({ concrete: 'Test concrete', pattern: 'Test pattern', principle: 'Test principle' })
    const understanding = JSON.stringify({ confidence: 7, canTeachIt: true, knownGaps: [] })
    const effort = JSON.stringify({ processingTime: '30min', cognitiveLoad: 'moderate' })
    const resonance = JSON.stringify({ intensity: 5, valence: 'positive' })
    const tags = JSON.stringify(['typescript'])

    // Insert learning
    const embedding = await embedder.embed('TypeScript content')
    getRawDb(drizzleDb).prepare(`
      INSERT INTO learnings (
        learning_id, title, context, insight, why, implications, tags,
        abstraction, understanding, effort, resonance,
        conversation_uuid, embedding, created_at
      ) VALUES ('learn-1', 'TypeScript', 'Context', 'TypeScript content', 'Why', 'Implications', ?, ?, ?, ?, ?, 'conv-1', ?, '${now}')
    `).run(tags, abstraction, understanding, effort, resonance, Buffer.from(embedding.buffer))

    // Search
    const results = await search.search('TypeScript', { limit: 10 })

    expect(results.length).toBeGreaterThan(0)

    // Verify source conversation enrichment (singular, not plural)
    const source = results[0].sourceConversation
    expect(source?.uuid).toBe('conv-1')
    expect(source?.title).toBe('TypeScript Tutorial')
    expect(source?.createdAt).toBeInstanceOf(Date)
  })

  it('should handle learnings with no tags', async () => {
    const now = new Date().toISOString()

    // Insert conversation
    getRawDb(drizzleDb).prepare(`
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES ('conv-1', 'Test', '${now}', '${now}', 'claude', 0)
    `).run()

    // Common JSON fields
    const abstraction = JSON.stringify({ concrete: 'Test concrete', pattern: 'Test pattern', principle: 'Test principle' })
    const understanding = JSON.stringify({ confidence: 7, canTeachIt: true, knownGaps: [] })
    const effort = JSON.stringify({ processingTime: '30min', cognitiveLoad: 'moderate' })
    const resonance = JSON.stringify({ intensity: 5, valence: 'positive' })
    const emptyTags = JSON.stringify([])

    // Insert learning without tags
    const embedding = await embedder.embed('uncategorized content')
    getRawDb(drizzleDb).prepare(`
      INSERT INTO learnings (
        learning_id, title, context, insight, why, implications, tags,
        abstraction, understanding, effort, resonance,
        conversation_uuid, embedding, created_at
      ) VALUES ('learn-1', 'Uncategorized', 'Context', 'uncategorized content', 'Why', 'Implications', ?, ?, ?, ?, ?, 'conv-1', ?, '${now}')
    `).run(emptyTags, abstraction, understanding, effort, resonance, Buffer.from(embedding.buffer))

    // Search
    const results = await search.search('content', { limit: 10 })

    expect(results.length).toBeGreaterThan(0)
    expect(results[0].learning.tags).toEqual([])
  })

  it('should handle large result sets efficiently', async () => {
    const now = new Date().toISOString()

    // Insert conversation
    getRawDb(drizzleDb).prepare(`
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES ('conv-1', 'Test', '${now}', '${now}', 'claude', 0)
    `).run()

    // Common JSON fields
    const abstraction = JSON.stringify({ concrete: 'Test concrete', pattern: 'Test pattern', principle: 'Test principle' })
    const understanding = JSON.stringify({ confidence: 7, canTeachIt: true, knownGaps: [] })
    const effort = JSON.stringify({ processingTime: '30min', cognitiveLoad: 'moderate' })
    const resonance = JSON.stringify({ intensity: 5, valence: 'positive' })
    const tags = JSON.stringify(['test'])

    // Insert 100 learnings
    for (let i = 0; i < 100; i++) {
      const text = `Learning ${i} about programming and software development`
      const embedding = await embedder.embed(text)

      getRawDb(drizzleDb).prepare(`
        INSERT INTO learnings (
          learning_id, title, context, insight, why, implications, tags,
          abstraction, understanding, effort, resonance,
          conversation_uuid, embedding, created_at
        ) VALUES (?, ?, 'Context', ?, 'Why', 'Implications', ?, ?, ?, ?, ?, 'conv-1', ?, '${now}')
      `).run(`learn-${i}`, text, text, tags, abstraction, understanding, effort, resonance, Buffer.from(embedding.buffer))
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
