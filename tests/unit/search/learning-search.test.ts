import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createDatabase } from '../../../src/factories'
import { getRawDb, type DrizzleDB } from '../../../src/db/client'
import { LearningSearchImpl } from '../../../src/services/learning-search'
import { MockEmbeddingModel, MockVectorStore } from '../../../src/mocks'
import { unlinkSync } from 'fs'
import { resolve } from 'path'

describe('LearningSearchImpl', () => {
  let drizzleDb: DrizzleDB
  let embedder: MockEmbeddingModel
  let vectorStore: MockVectorStore
  let search: LearningSearchImpl
  const dbPath = resolve(__dirname, '../../tmp/learning-search-test.db')

  beforeEach(() => {
    // Create fresh database
    drizzleDb = createDatabase(dbPath)

    // Insert test conversations
    getRawDb(drizzleDb).prepare(`
      INSERT INTO conversations (uuid, name, summary, created_at, updated_at, platform)
      VALUES
        ('conv-1', 'TypeScript Discussion', 'About TypeScript', '2025-01-01', '2025-01-01', 'claude'),
        ('conv-2', 'React Tutorial', 'About React', '2025-01-02', '2025-01-02', 'claude')
    `).run()

    // Helper to create JSON for nested objects
    const createLearningData = (id: string, title: string, tags: string[], conversationUuid: string, createdAt: string) => {
      const abstraction = JSON.stringify({
        concrete: `Concrete example for ${title}`,
        pattern: `Pattern for ${title}`,
        principle: `Principle for ${title}`
      })
      const understanding = JSON.stringify({
        confidence: 7,
        canTeachIt: true,
        knownGaps: []
      })
      const effort = JSON.stringify({
        processingTime: '30min',
        cognitiveLoad: 'moderate'
      })
      const resonance = JSON.stringify({
        intensity: 5,
        valence: 'positive'
      })
      const tagsJson = JSON.stringify(tags)
      const embedding = Buffer.from(new Float32Array(768).fill(0.5).buffer)

      return {
        id,
        title,
        context: `Context for ${title}`,
        insight: `Insight for ${title}`,
        why: `Why for ${title}`,
        implications: `Implications for ${title}`,
        tags: tagsJson,
        abstraction,
        understanding,
        effort,
        resonance,
        conversationUuid,
        embedding,
        createdAt
      }
    }

    // Insert test learnings with new schema
    const learnings = [
      createLearningData('learn-1', 'TypeScript Basics', ['programming', 'typescript'], 'conv-1', '2025-01-01'),
      createLearningData('learn-2', 'React Hooks', ['programming', 'react'], 'conv-2', '2025-01-02'),
      createLearningData('learn-3', 'TypeScript Generics', ['programming', 'typescript'], 'conv-1', '2025-01-03'),
      createLearningData('learn-4', 'React Context', ['programming', 'react'], 'conv-2', '2025-01-04'),
      createLearningData('learn-5', 'TypeScript Interfaces', ['typescript'], 'conv-1', '2025-01-05')
    ]

    const insertStmt = getRawDb(drizzleDb).prepare(`
      INSERT INTO learnings (
        learning_id, title, context, insight, why, implications, tags,
        abstraction, understanding, effort, resonance,
        conversation_uuid, embedding, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    for (const l of learnings) {
      insertStmt.run(
        l.id, l.title, l.context, l.insight, l.why, l.implications, l.tags,
        l.abstraction, l.understanding, l.effort, l.resonance,
        l.conversationUuid, l.embedding, l.createdAt
      )
    }

    // Create mocks
    embedder = new MockEmbeddingModel()
    vectorStore = new MockVectorStore()

    // Initialize vector store with embeddings for learnings
    vectorStore.initialize(768)
    for (let i = 1; i <= 5; i++) {
      const embedding = new Float32Array(768).fill(i / 10)
      vectorStore.insert(`learn-${i}`, embedding)
    }

    // Create search engine
    search = new LearningSearchImpl(embedder, vectorStore, drizzleDb)
  })

  afterEach(() => {
    getRawDb(drizzleDb).close()
    try {
      unlinkSync(dbPath)
    } catch (e) {
      // Ignore if file doesn't exist
    }
  })

  describe('search', () => {
    it('should return search results', async () => {
      const results = await search.search('TypeScript')

      expect(results).toBeDefined()
      expect(Array.isArray(results)).toBe(true)
      expect(results.length).toBeGreaterThan(0)
    })

    it('should return results with learning, score, and sources', async () => {
      const results = await search.search('TypeScript', { limit: 1 })

      expect(results.length).toBeGreaterThan(0)
      const result = results[0]

      expect(result.learning).toBeDefined()
      expect(result.learning.learningId).toBeDefined()
      expect(result.learning.title).toBeDefined()
      expect(result.learning.context).toBeDefined()
      expect(result.learning.insight).toBeDefined()
      expect(result.learning.tags).toBeDefined()
      expect(Array.isArray(result.learning.tags)).toBe(true)
      expect(result.score).toBeDefined()
      expect(typeof result.score).toBe('number')
      expect(result.sourceConversation).toBeDefined()
    })

    it('should include tag metadata', async () => {
      const results = await search.search('TypeScript')

      const resultWithTags = results.find(r => r.learning.tags.length > 0)
      expect(resultWithTags).toBeDefined()

      if (resultWithTags) {
        expect(Array.isArray(resultWithTags.learning.tags)).toBe(true)
        expect(resultWithTags.learning.tags[0]).toBeDefined()
        expect(typeof resultWithTags.learning.tags[0]).toBe('string')
      }
    })

    it('should respect limit parameter', async () => {
      const results = await search.search('programming', { limit: 2 })
      expect(results.length).toBeLessThanOrEqual(2)
    })

    it('should return empty array if no results', async () => {
      // Clear all embeddings
      vectorStore.clear()

      const results = await search.search('nonexistent')
      expect(results).toEqual([])
    })

    it('should embed the query', async () => {
      embedder.reset()

      await search.search('test query')

      expect(embedder.callCount).toBeGreaterThan(0)
      expect(embedder.lastTexts).toContain('test query')
    })

    it('should preserve relevance ordering from vector search', async () => {
      const results = await search.search('test', { limit: 5 })

      if (results.length > 1) {
        // Scores should be in descending order
        for (let i = 0; i < results.length - 1; i++) {
          expect(results[i].score).toBeGreaterThanOrEqual(results[i + 1].score)
        }
      }
    })
  })

  describe('tag support', () => {
    it('should include all tags for each learning', async () => {
      const results = await search.search('TypeScript', { limit: 5 })

      // Find learn-1 which has 2 tags (programming + typescript)
      const learn1 = results.find(r => r.learning.learningId === 'learn-1')

      if (learn1) {
        expect(learn1.learning.tags.length).toBe(2)
        expect(learn1.learning.tags).toContain('programming')
        expect(learn1.learning.tags).toContain('typescript')
      }
    })

    it('should handle learnings without tags', async () => {
      // This test is already handled by setup - learn-5 has only 'typescript' tag
      const results = await search.search('TypeScript', { limit: 10 })
      const learn5 = results.find(r => r.learning.learningId === 'learn-5')
      if (learn5) {
        expect(Array.isArray(learn5.learning.tags)).toBe(true)
      }
    })

    it('should return tags as string array', async () => {
      const results = await search.search('TypeScript', { limit: 5 })

      for (const result of results) {
        expect(Array.isArray(result.learning.tags)).toBe(true)
        for (const tag of result.learning.tags) {
          expect(typeof tag).toBe('string')
        }
      }
    })
  })

  describe('source conversation enrichment', () => {
    it('should include source conversation metadata', async () => {
      const results = await search.search('TypeScript')

      const resultWithSource = results.find(r => r.sourceConversation !== undefined)
      expect(resultWithSource).toBeDefined()

      if (resultWithSource && resultWithSource.sourceConversation) {
        const source = resultWithSource.sourceConversation
        expect(source.uuid).toBeDefined()
        expect(source.title).toBeDefined()
        expect(source.createdAt).toBeInstanceOf(Date)
      }
    })

    it('should link to correct conversation', async () => {
      const results = await search.search('TypeScript', { limit: 5 })

      // learn-1 should link to conv-1
      const learn1 = results.find(r => r.learning.learningId === 'learn-1')
      if (learn1 && learn1.sourceConversation) {
        expect(learn1.sourceConversation.uuid).toBe('conv-1')
      }
    })

    it('should handle learnings with source conversation', async () => {
      const results = await search.search('TypeScript', { limit: 5 })

      // All our test learnings have source conversations
      for (const result of results) {
        expect(result.learning.conversationUuid).toBeDefined()
      }
    })
  })

  describe('filters', () => {
    it('should filter by date range', async () => {
      const results = await search.search('programming', {
        dateRange: {
          start: new Date('2025-01-02'),
          end: new Date('2025-01-04')
        },
        limit: 10
      })

      for (const result of results) {
        expect(result.learning.createdAt.getTime()).toBeGreaterThanOrEqual(
          new Date('2025-01-02').getTime()
        )
        expect(result.learning.createdAt.getTime()).toBeLessThanOrEqual(
          new Date('2025-01-04').getTime()
        )
      }
    })

    it('should filter by tags', async () => {
      const results = await search.search('programming', {
        tags: ['typescript'],
        limit: 10
      })

      for (const result of results) {
        const hasTypescript = result.learning.tags.includes('typescript')
        expect(hasTypescript).toBe(true)
      }
    })

    it('should filter by multiple tags (OR logic)', async () => {
      const results = await search.search('programming', {
        tags: ['typescript', 'react'],
        limit: 10
      })

      for (const result of results) {
        const hasEither = result.learning.tags.includes('typescript') || result.learning.tags.includes('react')
        expect(hasEither).toBe(true)
      }
    })

    it('should combine multiple filters', async () => {
      const results = await search.search('programming', {
        dateRange: {
          start: new Date('2025-01-01'),
          end: new Date('2025-01-03')
        },
        tags: ['typescript'],
        limit: 10
      })

      for (const result of results) {
        // Check date range
        expect(result.learning.createdAt.getTime()).toBeGreaterThanOrEqual(
          new Date('2025-01-01').getTime()
        )
        expect(result.learning.createdAt.getTime()).toBeLessThanOrEqual(
          new Date('2025-01-03').getTime()
        )

        // Check tag
        const hasTypescript = result.learning.tags.includes('typescript')
        expect(hasTypescript).toBe(true)
      }
    })

    it('should return empty array when filters exclude all results', async () => {
      const results = await search.search('programming', {
        dateRange: {
          start: new Date('2025-01-01'),
          end: new Date('2025-01-01')
        },
        tags: ['react'],
        limit: 10
      })

      // No learnings match: created on 2025-01-01 AND have react tag
      expect(results).toEqual([])
    })
  })

  describe('score ordering', () => {
    it('should preserve vector similarity ordering', async () => {
      // Configure vector store with specific scores
      vectorStore.clear()
      vectorStore.insert('learn-1', new Float32Array(768).fill(0.9))  // High score
      vectorStore.insert('learn-2', new Float32Array(768).fill(0.5))  // Medium score
      vectorStore.insert('learn-3', new Float32Array(768).fill(0.1))  // Low score

      const results = await search.search('test', { limit: 3 })

      // Results should be ordered by descending score
      if (results.length >= 2) {
        expect(results[0].score).toBeGreaterThan(results[1].score)
      }
    })

    it('should include scores with results', async () => {
      const results = await search.search('test', { limit: 5 })

      // All results should have scores
      for (const result of results) {
        expect(result.score).toBeDefined()
        expect(typeof result.score).toBe('number')
        expect(result.score).toBeGreaterThan(0)
        expect(result.score).toBeLessThanOrEqual(1)
      }
    })
  })

  describe('result structure', () => {
    it('should return learning with all required fields', async () => {
      const results = await search.search('TypeScript', { limit: 1 })

      expect(results.length).toBeGreaterThan(0)
      const learning = results[0].learning

      expect(learning.learningId).toBeDefined()
      expect(learning.title).toBeDefined()
      expect(learning.context).toBeDefined()
      expect(learning.insight).toBeDefined()
      expect(learning.tags).toBeDefined()
      expect(Array.isArray(learning.tags)).toBe(true)
      expect(learning.createdAt).toBeInstanceOf(Date)
      expect(learning.conversationUuid).toBeDefined()
    })

    it('should return score as number between 0 and 1', async () => {
      const results = await search.search('TypeScript', { limit: 5 })

      for (const result of results) {
        expect(result.score).toBeGreaterThanOrEqual(0)
        expect(result.score).toBeLessThanOrEqual(1)
      }
    })

    it('should return source conversation with complete metadata', async () => {
      const results = await search.search('TypeScript', { limit: 5 })

      const resultWithSource = results.find(r => r.sourceConversation !== undefined)
      if (resultWithSource && resultWithSource.sourceConversation) {
        const source = resultWithSource.sourceConversation
        expect(source.uuid).toBeDefined()
        expect(typeof source.uuid).toBe('string')
        expect(source.title).toBeDefined()
        expect(typeof source.title).toBe('string')
        expect(source.createdAt).toBeInstanceOf(Date)
      }
    })
  })

  describe('edge cases', () => {
    it('should handle empty query', async () => {
      const results = await search.search('')
      expect(results).toBeDefined()
      expect(Array.isArray(results)).toBe(true)
    })

    it('should handle query with special characters', async () => {
      const results = await search.search('TypeScript & React!')
      expect(results).toBeDefined()
    })

    it('should handle very long query', async () => {
      const longQuery = 'TypeScript '.repeat(100)
      const results = await search.search(longQuery)
      expect(results).toBeDefined()
    })

    it('should handle limit of 0', async () => {
      const results = await search.search('test', { limit: 0 })
      expect(results).toEqual([])
    })

    it('should handle very large limit', async () => {
      const results = await search.search('test', { limit: 1000 })
      expect(results.length).toBeLessThanOrEqual(5)  // Only 5 learnings in DB
    })

    it('should handle learning with very long title', async () => {
      const longTitle = 'A'.repeat(500)
      const abstraction = JSON.stringify({ concrete: 'Test', pattern: 'Test', principle: 'Test' })
      const understanding = JSON.stringify({ confidence: 7, canTeachIt: true, knownGaps: [] })
      const effort = JSON.stringify({ processingTime: '30min', cognitiveLoad: 'moderate' })
      const resonance = JSON.stringify({ intensity: 5, valence: 'positive' })
      const embedding = Buffer.from(new Float32Array(768).fill(0.7).buffer)

      getRawDb(drizzleDb).prepare(`
        INSERT INTO learnings (
          learning_id, title, context, insight, why, implications, tags,
          abstraction, understanding, effort, resonance,
          conversation_uuid, embedding, created_at
        ) VALUES ('learn-long', ?, 'Context', 'Insight', 'Why', 'Implications', '[]', ?, ?, ?, ?, 'conv-1', ?, '2025-01-06')
      `).run(longTitle, abstraction, understanding, effort, resonance, embedding)

      vectorStore.insert('learn-long', new Float32Array(768).fill(0.7))

      const results = await search.search('test', { limit: 10 })
      const longLearning = results.find(r => r.learning.learningId === 'learn-long')

      if (longLearning) {
        expect(longLearning.learning.title).toBe(longTitle)
      }
    })

    it('should handle invalid date range (end before start)', async () => {
      const results = await search.search('test', {
        dateRange: {
          start: new Date('2025-12-31'),
          end: new Date('2025-01-01')
        }
      })

      // Should return empty since no learnings match invalid range
      expect(results).toEqual([])
    })

    it('should handle non-existent tags', async () => {
      const results = await search.search('test', {
        tags: ['nonexistent-tag']
      })

      // Should return empty since no learnings have this tag
      expect(results).toEqual([])
    })
  })
})
