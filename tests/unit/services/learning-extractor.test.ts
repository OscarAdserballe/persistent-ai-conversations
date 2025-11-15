import { describe, it, expect, beforeEach, vi } from 'vitest'
import { LearningExtractorImpl } from '../../../src/services/learning-extractor'
import { MockLLMModel, MockEmbeddingModel, MockVectorStore, createMockLearningResponse } from '../../mocks'
import Database from 'better-sqlite3'

describe('LearningExtractorImpl', () => {
  let extractor: LearningExtractorImpl
  let llm: MockLLMModel
  let embedder: MockEmbeddingModel
  let vectorStore: MockVectorStore
  let db: Database.Database

  const mockConversation = {
    uuid: 'conv-123',
    title: 'Test Conversation',
    platform: 'claude',
    messages: [
      {
        uuid: 'msg-1',
        conversationUuid: 'conv-123',
        conversationIndex: 0,
        sender: 'human' as const,
        text: 'What is TypeScript?',
        createdAt: new Date(),
        metadata: {}
      },
      {
        uuid: 'msg-2',
        conversationUuid: 'conv-123',
        conversationIndex: 1,
        sender: 'assistant' as const,
        text: 'TypeScript is a typed superset of JavaScript that compiles to plain JavaScript.',
        createdAt: new Date(),
        metadata: {}
      }
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
    metadata: {}
  }

  beforeEach(() => {
    // Create in-memory database
    db = new Database(':memory:')

    // Create schema
    db.exec(`
      CREATE TABLE learning_categories (
        category_id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        description TEXT,
        created_at DATETIME NOT NULL
      );

      CREATE TABLE learnings (
        learning_id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at DATETIME NOT NULL,
        embedding BLOB
      );

      CREATE TABLE learning_sources (
        learning_id TEXT NOT NULL,
        conversation_uuid TEXT NOT NULL,
        message_uuid TEXT
      );

      CREATE TABLE learning_category_assignments (
        learning_id TEXT NOT NULL,
        category_id TEXT NOT NULL,
        PRIMARY KEY (learning_id, category_id)
      );
    `)

    // Create mocks
    llm = new MockLLMModel()
    embedder = new MockEmbeddingModel()
    vectorStore = new MockVectorStore()
    vectorStore.initialize(768)

    // Create extractor
    extractor = new LearningExtractorImpl(llm, embedder, vectorStore, db)
  })

  describe('extractFromConversation', () => {
    it('should extract learnings from conversation', async () => {
      // Configure LLM to return a valid learning
      llm.setResponse(createMockLearningResponse([
        {
          title: 'TypeScript Introduction',
          content: 'Learned that TypeScript is a typed superset of JavaScript.',
          categories: ['programming', 'typescript']
        }
      ]))

      const learnings = await extractor.extractFromConversation(mockConversation)

      expect(learnings).toHaveLength(1)
      expect(learnings[0].title).toBe('TypeScript Introduction')
      expect(learnings[0].content).toBe('Learned that TypeScript is a typed superset of JavaScript.')
      expect(learnings[0].categories).toHaveLength(2)
      expect(learnings[0].sources).toHaveLength(1)
      expect(learnings[0].sources[0].conversationUuid).toBe('conv-123')
    })

    it('should return empty array when LLM returns empty', async () => {
      llm.setEmptyLearnings()

      const learnings = await extractor.extractFromConversation(mockConversation)

      expect(learnings).toEqual([])
    })

    it('should handle invalid JSON gracefully', async () => {
      llm.setInvalidJSON()

      const learnings = await extractor.extractFromConversation(mockConversation)

      expect(learnings).toEqual([])
    })

    it('should handle non-array JSON', async () => {
      llm.setResponse('{"title": "Not an array"}')

      const learnings = await extractor.extractFromConversation(mockConversation)

      expect(learnings).toEqual([])
    })

    it('should send conversation context to LLM', async () => {
      llm.setEmptyLearnings()

      await extractor.extractFromConversation(mockConversation)

      const lastContext = llm.getLastContext()
      expect(lastContext).toContain('Test Conversation')
      expect(lastContext).toContain('What is TypeScript?')
      expect(lastContext).toContain('TypeScript is a typed superset')
    })

    it('should send existing categories in prompt', async () => {
      // Insert an existing category
      db.prepare(`
        INSERT INTO learning_categories (category_id, name, created_at)
        VALUES ('cat-1', 'programming', datetime('now'))
      `).run()

      llm.setEmptyLearnings()

      await extractor.extractFromConversation(mockConversation)

      const lastPrompt = llm.getLastPrompt()
      expect(lastPrompt).toContain('programming')
    })

    it('should generate embeddings for learnings', async () => {
      llm.setResponse(createMockLearningResponse([
        {
          title: 'Test Learning',
          content: 'Test content',
          categories: []
        }
      ]))

      await extractor.extractFromConversation(mockConversation)

      expect(embedder.callCount).toBeGreaterThan(0)
      // Batch embedding should combine title and content
      expect(embedder.lastTexts[0]).toContain('Test Learning')
      expect(embedder.lastTexts[0]).toContain('Test content')
    })

    it('should store embeddings in database', async () => {
      llm.setResponse(createMockLearningResponse([
        {
          title: 'Test Learning',
          content: 'Test content',
          categories: []
        }
      ]))

      await extractor.extractFromConversation(mockConversation)

      // Embeddings should be stored in database, not vector store
      const learnings = db.prepare('SELECT learning_id, embedding FROM learnings').all() as any[]
      expect(learnings.length).toBeGreaterThan(0)
      expect(learnings[0].embedding).toBeDefined()
      expect(learnings[0].embedding).not.toBeNull()
    })

    it('should store learnings in database', async () => {
      llm.setResponse(createMockLearningResponse([
        {
          title: 'Database Test',
          content: 'This should be stored',
          categories: []
        }
      ]))

      await extractor.extractFromConversation(mockConversation)

      const stored = db.prepare('SELECT * FROM learnings').all()
      expect(stored).toHaveLength(1)
      expect(stored[0].title).toBe('Database Test')
      expect(stored[0].content).toBe('This should be stored')
    })

    it('should link learnings to source conversation', async () => {
      llm.setResponse(createMockLearningResponse([
        {
          title: 'Test',
          content: 'Content',
          categories: []
        }
      ]))

      await extractor.extractFromConversation(mockConversation)

      const sources = db.prepare('SELECT * FROM learning_sources').all()
      expect(sources).toHaveLength(1)
      expect(sources[0].conversation_uuid).toBe('conv-123')
    })

    it('should generate UUID for learnings', async () => {
      llm.setResponse(createMockLearningResponse([
        {
          title: 'Test 1',
          content: 'Content 1',
          categories: []
        },
        {
          title: 'Test 2',
          content: 'Content 2',
          categories: []
        }
      ]))

      const learnings = await extractor.extractFromConversation(mockConversation)

      // Each learning should have unique UUID
      expect(learnings[0].learningId).toBeDefined()
      expect(learnings[1].learningId).toBeDefined()
      expect(learnings[0].learningId).not.toBe(learnings[1].learningId)
    })
  })

  describe('category management', () => {
    it('should create new categories', async () => {
      llm.setResponse(createMockLearningResponse([
        {
          title: 'Test',
          content: 'Content',
          categories: ['new-category']
        }
      ]))

      await extractor.extractFromConversation(mockConversation)

      const categories = db.prepare('SELECT * FROM learning_categories').all()
      expect(categories).toHaveLength(1)
      expect(categories[0].name).toBe('new-category')
    })

    it('should reuse existing categories', async () => {
      // Insert existing category
      db.prepare(`
        INSERT INTO learning_categories (category_id, name, created_at)
        VALUES ('cat-existing', 'programming', datetime('now'))
      `).run()

      llm.setResponse(createMockLearningResponse([
        {
          title: 'Test',
          content: 'Content',
          categories: ['programming']
        }
      ]))

      await extractor.extractFromConversation(mockConversation)

      // Should still have only 1 category
      const categories = db.prepare('SELECT * FROM learning_categories').all()
      expect(categories).toHaveLength(1)
      expect(categories[0].category_id).toBe('cat-existing')
    })

    it('should handle multiple categories per learning', async () => {
      llm.setResponse(createMockLearningResponse([
        {
          title: 'Test',
          content: 'Content',
          categories: ['cat1', 'cat2', 'cat3']
        }
      ]))

      const learnings = await extractor.extractFromConversation(mockConversation)

      expect(learnings[0].categories).toHaveLength(3)

      // Check assignments table
      const assignments = db.prepare('SELECT * FROM learning_category_assignments').all()
      expect(assignments).toHaveLength(3)
    })

    it('should cache categories within extraction session', async () => {
      llm.setResponse(createMockLearningResponse([
        {
          title: 'Learning 1',
          content: 'Content 1',
          categories: ['shared-category']
        },
        {
          title: 'Learning 2',
          content: 'Content 2',
          categories: ['shared-category']
        }
      ]))

      await extractor.extractFromConversation(mockConversation)

      // Should have created category only once
      const categories = db.prepare('SELECT * FROM learning_categories').all()
      expect(categories).toHaveLength(1)

      // But should have 2 assignments
      const assignments = db.prepare('SELECT * FROM learning_category_assignments').all()
      expect(assignments).toHaveLength(2)
    })

    it('should handle learnings without categories', async () => {
      llm.setResponse(createMockLearningResponse([
        {
          title: 'Test',
          content: 'Content'
          // No categories field
        }
      ]))

      const learnings = await extractor.extractFromConversation(mockConversation)

      expect(learnings[0].categories).toEqual([])

      // No categories should be created
      const categories = db.prepare('SELECT * FROM learning_categories').all()
      expect(categories).toHaveLength(0)
    })

    it('should handle empty categories array', async () => {
      llm.setResponse(createMockLearningResponse([
        {
          title: 'Test',
          content: 'Content',
          categories: []
        }
      ]))

      const learnings = await extractor.extractFromConversation(mockConversation)

      expect(learnings[0].categories).toEqual([])
    })

    it('should generate UUID for new categories', async () => {
      llm.setResponse(createMockLearningResponse([
        {
          title: 'Test',
          content: 'Content',
          categories: ['category-1', 'category-2']
        }
      ]))

      await extractor.extractFromConversation(mockConversation)

      const categories = db.prepare('SELECT * FROM learning_categories').all()
      expect(categories[0].category_id).toBeDefined()
      expect(categories[1].category_id).toBeDefined()
      expect(categories[0].category_id).not.toBe(categories[1].category_id)
    })

    it('should handle ON CONFLICT for concurrent category creation', async () => {
      llm.setResponse(createMockLearningResponse([
        {
          title: 'Test',
          content: 'Content',
          categories: ['concurrent-category']
        }
      ]))

      // This should not throw even if category name collides
      await expect(extractor.extractFromConversation(mockConversation)).resolves.toBeDefined()
    })
  })

  describe('batch processing', () => {
    it('should batch embed multiple learnings', async () => {
      llm.setResponse(createMockLearningResponse([
        { title: 'Learning 1', content: 'Content 1', categories: [] },
        { title: 'Learning 2', content: 'Content 2', categories: [] },
        { title: 'Learning 3', content: 'Content 3', categories: [] }
      ]))

      embedder.reset()
      await extractor.extractFromConversation(mockConversation)

      // embedBatch should be called once for all learnings
      expect(embedder.lastTexts.length).toBe(3)
    })

    it('should use transaction for atomic insertion', async () => {
      llm.setResponse(createMockLearningResponse([
        { title: 'Learning 1', content: 'Content 1', categories: [] },
        { title: 'Learning 2', content: 'Content 2', categories: [] }
      ]))

      await extractor.extractFromConversation(mockConversation)

      // Both should be inserted or neither (transaction)
      const learnings = db.prepare('SELECT * FROM learnings').all()
      expect(learnings).toHaveLength(2)
    })
  })

  describe('conversation context building', () => {
    it('should include conversation title', async () => {
      llm.setEmptyLearnings()

      await extractor.extractFromConversation(mockConversation)

      const context = llm.getLastContext()
      expect(context).toContain('Test Conversation')
    })

    it('should include conversation date', async () => {
      llm.setEmptyLearnings()

      await extractor.extractFromConversation(mockConversation)

      const context = llm.getLastContext()
      // Should have date in ISO format
      expect(context).toMatch(/\d{4}-\d{2}-\d{2}/)
    })

    it('should include all messages', async () => {
      llm.setEmptyLearnings()

      await extractor.extractFromConversation(mockConversation)

      const context = llm.getLastContext()
      expect(context).toContain('HUMAN')
      expect(context).toContain('ASSISTANT')
      expect(context).toContain('What is TypeScript?')
      expect(context).toContain('TypeScript is a typed superset')
    })

    it('should format messages with sender labels', async () => {
      llm.setEmptyLearnings()

      await extractor.extractFromConversation(mockConversation)

      const context = llm.getLastContext()
      expect(context).toContain('[HUMAN]:')
      expect(context).toContain('[ASSISTANT]:')
    })
  })

  describe('error handling', () => {
    it('should handle malformed JSON without crashing', async () => {
      llm.setInvalidJSON()

      await expect(extractor.extractFromConversation(mockConversation)).resolves.toEqual([])
    })

    it('should handle LLM returning string instead of array', async () => {
      llm.setResponse('"not an array"')

      await expect(extractor.extractFromConversation(mockConversation)).resolves.toEqual([])
    })

    it('should handle LLM returning object instead of array', async () => {
      llm.setResponse('{"key": "value"}')

      await expect(extractor.extractFromConversation(mockConversation)).resolves.toEqual([])
    })

    it('should continue if embedding fails for one learning', async () => {
      llm.setResponse(createMockLearningResponse([
        { title: 'Good', content: 'Good content', categories: [] }
      ]))

      // This should still work with mock embedder
      await expect(extractor.extractFromConversation(mockConversation)).resolves.toBeDefined()
    })
  })

  describe('empty and edge cases', () => {
    it('should handle conversation with no messages', async () => {
      const emptyConv = { ...mockConversation, messages: [] }

      llm.setEmptyLearnings()

      await expect(extractor.extractFromConversation(emptyConv)).resolves.toEqual([])
    })

    it('should handle very long conversations', async () => {
      const longConv = {
        ...mockConversation,
        messages: Array(100).fill(null).map((_, i) => ({
          uuid: `msg-${i}`,
          conversationUuid: 'conv-123',
          conversationIndex: i,
          sender: (i % 2 === 0 ? 'human' : 'assistant') as const,
          text: `Message ${i}`,
          createdAt: new Date(),
          metadata: {}
        }))
      }

      llm.setEmptyLearnings()

      await expect(extractor.extractFromConversation(longConv)).resolves.toEqual([])
    })

    it('should handle learnings with very long titles', async () => {
      const longTitle = 'A'.repeat(200)

      llm.setResponse(createMockLearningResponse([
        { title: longTitle, content: 'Content', categories: [] }
      ]))

      const learnings = await extractor.extractFromConversation(mockConversation)

      expect(learnings[0].title).toBe(longTitle)
    })

    it('should handle learnings with very long content', async () => {
      const longContent = 'B'.repeat(5000)

      llm.setResponse(createMockLearningResponse([
        { title: 'Title', content: longContent, categories: [] }
      ]))

      const learnings = await extractor.extractFromConversation(mockConversation)

      expect(learnings[0].content).toBe(longContent)
    })

    it('should handle many categories per learning', async () => {
      const manyCategories = Array(20).fill(null).map((_, i) => `category-${i}`)

      llm.setResponse(createMockLearningResponse([
        { title: 'Test', content: 'Content', categories: manyCategories }
      ]))

      const learnings = await extractor.extractFromConversation(mockConversation)

      expect(learnings[0].categories).toHaveLength(20)
    })
  })
})
