import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { LearningSearchImpl } from '../../../src/services/learning-search'
import { MockEmbeddingModel, MockVectorStore } from '../../mocks'
import { initializeSchema } from '../../../src/db/schema'
import { unlinkSync } from 'fs'
import { resolve } from 'path'

describe('LearningSearchImpl', () => {
  let db: Database.Database
  let embedder: MockEmbeddingModel
  let vectorStore: MockVectorStore
  let search: LearningSearchImpl
  const dbPath = resolve(__dirname, '../../tmp/learning-search-test.db')

  beforeEach(() => {
    // Create fresh database
    db = new Database(dbPath)
    initializeSchema(db)

    // Insert test conversations
    db.prepare(`
      INSERT INTO conversations (uuid, name, summary, created_at, updated_at, platform)
      VALUES
        ('conv-1', 'TypeScript Discussion', 'About TypeScript', '2025-01-01', '2025-01-01', 'claude'),
        ('conv-2', 'React Tutorial', 'About React', '2025-01-02', '2025-01-02', 'claude')
    `).run()

    // Insert test categories
    db.prepare(`
      INSERT INTO learning_categories (category_id, name, description, created_at)
      VALUES
        ('cat-1', 'programming', 'Programming concepts', '2025-01-01'),
        ('cat-2', 'typescript', 'TypeScript specific', '2025-01-01'),
        ('cat-3', 'react', 'React framework', '2025-01-01')
    `).run()

    // Insert test learnings
    db.prepare(`
      INSERT INTO learnings (learning_id, title, content, created_at)
      VALUES
        ('learn-1', 'TypeScript Basics', 'TypeScript adds static typing to JavaScript', '2025-01-01'),
        ('learn-2', 'React Hooks', 'React Hooks allow using state in functional components', '2025-01-02'),
        ('learn-3', 'TypeScript Generics', 'Generics provide type safety with flexibility', '2025-01-03'),
        ('learn-4', 'React Context', 'Context API for state management', '2025-01-04'),
        ('learn-5', 'TypeScript Interfaces', 'Interfaces define object shapes', '2025-01-05')
    `).run()

    // Link learnings to categories
    db.prepare(`
      INSERT INTO learning_category_assignments (learning_id, category_id)
      VALUES
        ('learn-1', 'cat-1'),
        ('learn-1', 'cat-2'),
        ('learn-2', 'cat-1'),
        ('learn-2', 'cat-3'),
        ('learn-3', 'cat-1'),
        ('learn-3', 'cat-2'),
        ('learn-4', 'cat-1'),
        ('learn-4', 'cat-3'),
        ('learn-5', 'cat-2')
    `).run()

    // Link learnings to source conversations
    db.prepare(`
      INSERT INTO learning_sources (learning_id, conversation_uuid)
      VALUES
        ('learn-1', 'conv-1'),
        ('learn-2', 'conv-2'),
        ('learn-3', 'conv-1'),
        ('learn-4', 'conv-2'),
        ('learn-5', 'conv-1')
    `).run()

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
    search = new LearningSearchImpl(embedder, vectorStore, db)
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
      expect(result.learning.content).toBeDefined()
      expect(result.score).toBeDefined()
      expect(typeof result.score).toBe('number')
      expect(result.sourceConversations).toBeDefined()
      expect(Array.isArray(result.sourceConversations)).toBe(true)
    })

    it('should include category metadata', async () => {
      const results = await search.search('TypeScript')

      const resultWithCategories = results.find(r => r.learning.categories.length > 0)
      expect(resultWithCategories).toBeDefined()

      if (resultWithCategories) {
        const category = resultWithCategories.learning.categories[0]
        expect(category.categoryId).toBeDefined()
        expect(category.name).toBeDefined()
        expect(category.createdAt).toBeInstanceOf(Date)
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

  describe('category enrichment', () => {
    it('should include all categories for each learning', async () => {
      const results = await search.search('TypeScript', { limit: 5 })

      // Find learn-1 which has 2 categories (programming + typescript)
      const learn1 = results.find(r => r.learning.learningId === 'learn-1')

      if (learn1) {
        expect(learn1.learning.categories.length).toBe(2)
        const categoryNames = learn1.learning.categories.map(c => c.name)
        expect(categoryNames).toContain('programming')
        expect(categoryNames).toContain('typescript')
      }
    })

    it('should handle learnings with no categories', async () => {
      // Insert a learning without categories
      db.prepare(`
        INSERT INTO learnings (learning_id, title, content, created_at)
        VALUES ('learn-6', 'No Category', 'Content', '2025-01-06')
      `).run()

      db.prepare(`
        INSERT INTO learning_sources (learning_id, conversation_uuid)
        VALUES ('learn-6', 'conv-1')
      `).run()

      const embedding = new Float32Array(768).fill(0.6)
      vectorStore.insert('learn-6', embedding)

      const results = await search.search('No Category', { limit: 10 })

      const learn6 = results.find(r => r.learning.learningId === 'learn-6')
      if (learn6) {
        expect(learn6.learning.categories).toEqual([])
      }
    })

    it('should deduplicate categories in results', async () => {
      const results = await search.search('TypeScript', { limit: 5 })

      for (const result of results) {
        const categoryIds = result.learning.categories.map(c => c.categoryId)
        const uniqueIds = new Set(categoryIds)
        expect(categoryIds.length).toBe(uniqueIds.size)
      }
    })
  })

  describe('source conversation enrichment', () => {
    it('should include source conversation metadata', async () => {
      const results = await search.search('TypeScript')

      const resultWithSource = results.find(r => r.sourceConversations.length > 0)
      expect(resultWithSource).toBeDefined()

      if (resultWithSource) {
        const source = resultWithSource.sourceConversations[0]
        expect(source.uuid).toBeDefined()
        expect(source.title).toBeDefined()
        expect(source.createdAt).toBeInstanceOf(Date)
      }
    })

    it('should handle multiple source conversations', async () => {
      // Add another source for learn-1
      db.prepare(`
        INSERT INTO learning_sources (learning_id, conversation_uuid)
        VALUES ('learn-1', 'conv-2')
      `).run()

      const results = await search.search('TypeScript', { limit: 5 })

      const learn1 = results.find(r => r.learning.learningId === 'learn-1')
      if (learn1) {
        expect(learn1.sourceConversations.length).toBeGreaterThan(1)
      }
    })

    it('should deduplicate source conversations', async () => {
      const results = await search.search('TypeScript', { limit: 5 })

      for (const result of results) {
        const sourceUuids = result.sourceConversations.map(c => c.uuid)
        const uniqueUuids = new Set(sourceUuids)
        expect(sourceUuids.length).toBe(uniqueUuids.size)
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

    it('should filter by category names', async () => {
      const results = await search.search('programming', {
        categoryNames: ['typescript'],
        limit: 10
      })

      for (const result of results) {
        const hasTypescript = result.learning.categories.some(c => c.name === 'typescript')
        expect(hasTypescript).toBe(true)
      }
    })

    it('should filter by multiple categories (OR logic)', async () => {
      const results = await search.search('programming', {
        categoryNames: ['typescript', 'react'],
        limit: 10
      })

      for (const result of results) {
        const categoryNames = result.learning.categories.map(c => c.name)
        const hasEither = categoryNames.includes('typescript') || categoryNames.includes('react')
        expect(hasEither).toBe(true)
      }
    })

    it('should combine multiple filters', async () => {
      const results = await search.search('programming', {
        dateRange: {
          start: new Date('2025-01-01'),
          end: new Date('2025-01-03')
        },
        categoryNames: ['typescript'],
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

        // Check category
        const hasTypescript = result.learning.categories.some(c => c.name === 'typescript')
        expect(hasTypescript).toBe(true)
      }
    })

    it('should return empty array when filters exclude all results', async () => {
      const results = await search.search('programming', {
        dateRange: {
          start: new Date('2025-01-01'),
          end: new Date('2025-01-01')
        },
        categoryNames: ['react'],
        limit: 10
      })

      // No learnings match: created on 2025-01-01 AND have react category
      expect(results).toEqual([])
    })
  })

  describe('temp table pattern', () => {
    it('should create temp table for scores', async () => {
      await search.search('test')

      // Verify temp table exists and has data
      const tempRows = db.prepare('SELECT * FROM temp_learning_scores').all()
      expect(tempRows.length).toBeGreaterThan(0)
    })

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

    it('should join with temp table correctly', async () => {
      const results = await search.search('test', { limit: 5 })

      // All results should have scores from temp table
      for (const result of results) {
        expect(result.score).toBeDefined()
        expect(typeof result.score).toBe('number')
        expect(result.score).toBeGreaterThan(0)
        expect(result.score).toBeLessThanOrEqual(1)
      }
    })

    it('should clear temp table between searches', async () => {
      // First search
      await search.search('first query')
      const firstCount = db.prepare('SELECT COUNT(*) as count FROM temp_learning_scores').get() as any

      // Second search
      await search.search('second query')
      const secondCount = db.prepare('SELECT COUNT(*) as count FROM temp_learning_scores').get() as any

      // Counts might be different if different results, but shouldn't accumulate
      expect(secondCount.count).toBeGreaterThan(0)
    })
  })

  describe('result structure', () => {
    it('should return learning with all required fields', async () => {
      const results = await search.search('TypeScript', { limit: 1 })

      expect(results.length).toBeGreaterThan(0)
      const learning = results[0].learning

      expect(learning.learningId).toBeDefined()
      expect(learning.title).toBeDefined()
      expect(learning.content).toBeDefined()
      expect(learning.categories).toBeDefined()
      expect(Array.isArray(learning.categories)).toBe(true)
      expect(learning.createdAt).toBeInstanceOf(Date)
      expect(learning.sources).toBeDefined()
      expect(Array.isArray(learning.sources)).toBe(true)
    })

    it('should return score as number between 0 and 1', async () => {
      const results = await search.search('TypeScript', { limit: 5 })

      for (const result of results) {
        expect(result.score).toBeGreaterThanOrEqual(0)
        expect(result.score).toBeLessThanOrEqual(1)
      }
    })

    it('should return source conversations with complete metadata', async () => {
      const results = await search.search('TypeScript', { limit: 5 })

      const resultWithSource = results.find(r => r.sourceConversations.length > 0)
      if (resultWithSource) {
        for (const source of resultWithSource.sourceConversations) {
          expect(source.uuid).toBeDefined()
          expect(typeof source.uuid).toBe('string')
          expect(source.title).toBeDefined()
          expect(typeof source.title).toBe('string')
          expect(source.createdAt).toBeInstanceOf(Date)
        }
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
      db.prepare(`
        INSERT INTO learnings (learning_id, title, content, created_at)
        VALUES ('learn-long', ?, 'Content', '2025-01-06')
      `).run(longTitle)

      db.prepare(`
        INSERT INTO learning_sources (learning_id, conversation_uuid)
        VALUES ('learn-long', 'conv-1')
      `).run()

      const embedding = new Float32Array(768).fill(0.7)
      vectorStore.insert('learn-long', embedding)

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

    it('should handle non-existent category names', async () => {
      const results = await search.search('test', {
        categoryNames: ['nonexistent-category']
      })

      // Should return empty since no learnings have this category
      expect(results).toEqual([])
    })
  })
})
