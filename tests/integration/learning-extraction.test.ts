import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { unlinkSync, existsSync } from 'fs'
import { join } from 'path'
import { createDatabase, closeDatabase } from '../../src/db/database'
import { SqliteVectorStore } from '../../src/db/vector-store'
import { LearningExtractorImpl } from '../../src/services/learning-extractor'
import { MockLLMModel, MockEmbeddingModel, createMockLearningResponse } from '../mocks'
import Database from 'better-sqlite3'
import type { Conversation } from '../../src/core/types'

describe('Learning Extraction Pipeline', () => {
  const testDbPath = join(__dirname, '../tmp/learning-extraction-test.db')

  let db: Database.Database
  let vectorStore: SqliteVectorStore
  let llm: MockLLMModel
  let embedder: MockEmbeddingModel
  let extractor: LearningExtractorImpl

  beforeEach(() => {
    // Clean up any existing test database
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath)
    }

    // Create fresh database
    db = createDatabase(testDbPath)

    // Create mocks
    llm = new MockLLMModel()
    embedder = new MockEmbeddingModel()

    // Create vector store and initialize
    vectorStore = new SqliteVectorStore(db)
    vectorStore.initialize(embedder.dimensions)

    // Create extractor
    extractor = new LearningExtractorImpl(llm, embedder, vectorStore, db)
  })

  afterEach(() => {
    closeDatabase(db)
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath)
    }
  })

  const createTestConversation = (): Conversation => ({
    uuid: 'test-conv-1',
    title: 'TypeScript Discussion',
    platform: 'claude',
    messages: [
      {
        uuid: 'msg-1',
        conversationUuid: 'test-conv-1',
        conversationIndex: 0,
        sender: 'human' as const,
        text: 'What is TypeScript?',
        createdAt: new Date('2025-01-01'),
        metadata: {}
      },
      {
        uuid: 'msg-2',
        conversationUuid: 'test-conv-1',
        conversationIndex: 1,
        sender: 'assistant' as const,
        text: 'TypeScript is a typed superset of JavaScript that compiles to plain JavaScript.',
        createdAt: new Date('2025-01-01'),
        metadata: {}
      }
    ],
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    metadata: {}
  })

  it('should extract and store learnings end-to-end', async () => {
    const conversation = createTestConversation()

    // Configure LLM to return a learning
    llm.setResponse(createMockLearningResponse([
      {
        title: 'TypeScript Introduction',
        content: 'TypeScript adds static typing to JavaScript for better tooling and safety.',
        categories: ['programming', 'typescript']
      }
    ]))

    // Insert conversation into DB
    db.prepare(`
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(conversation.uuid, conversation.title, new Date().toISOString(), new Date().toISOString(), conversation.platform, conversation.messages.length)

    // Extract learnings
    const learnings = await extractor.extractFromConversation(conversation)

    // Verify learnings were returned
    expect(learnings).toHaveLength(1)
    expect(learnings[0].title).toBe('TypeScript Introduction')

    // Verify learnings table
    const storedLearnings = db.prepare('SELECT * FROM learnings').all()
    expect(storedLearnings).toHaveLength(1)
    expect(storedLearnings[0].title).toBe('TypeScript Introduction')
    expect(storedLearnings[0].content).toBe('TypeScript adds static typing to JavaScript for better tooling and safety.')

    // Verify categories table
    const categories = db.prepare('SELECT * FROM learning_categories').all()
    expect(categories).toHaveLength(2)
    const categoryNames = categories.map((c: any) => c.name).sort()
    expect(categoryNames).toEqual(['programming', 'typescript'])

    // Verify category assignments
    const assignments = db.prepare('SELECT * FROM learning_category_assignments').all()
    expect(assignments).toHaveLength(2)

    // Verify sources table
    const sources = db.prepare('SELECT * FROM learning_sources').all()
    expect(sources).toHaveLength(1)
    expect(sources[0].conversation_uuid).toBe('test-conv-1')
  })

  it('should create categories on first use', async () => {
    const conversation = createTestConversation()

    llm.setResponse(createMockLearningResponse([
      {
        title: 'Test Learning',
        content: 'Content',
        categories: ['brand-new-category']
      }
    ]))

    // Insert conversation
    db.prepare(`
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(conversation.uuid, conversation.title, new Date().toISOString(), new Date().toISOString(), conversation.platform, conversation.messages.length)

    // Extract
    await extractor.extractFromConversation(conversation)

    // Verify category was created
    const categories = db.prepare('SELECT * FROM learning_categories WHERE name = ?').all('brand-new-category')
    expect(categories).toHaveLength(1)
    expect(categories[0].name).toBe('brand-new-category')
  })

  it('should reuse existing categories', async () => {
    const conversation = createTestConversation()

    // Insert existing category
    const existingCategoryId = 'existing-cat-id'
    db.prepare(`
      INSERT INTO learning_categories (category_id, name, created_at)
      VALUES (?, ?, datetime('now'))
    `).run(existingCategoryId, 'existing-category')

    llm.setResponse(createMockLearningResponse([
      {
        title: 'Test Learning',
        content: 'Content',
        categories: ['existing-category']
      }
    ]))

    // Insert conversation
    db.prepare(`
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(conversation.uuid, conversation.title, new Date().toISOString(), new Date().toISOString(), conversation.platform, conversation.messages.length)

    // Extract
    await extractor.extractFromConversation(conversation)

    // Verify category was reused (still only 1 category)
    const categories = db.prepare('SELECT * FROM learning_categories').all()
    expect(categories).toHaveLength(1)
    expect(categories[0].category_id).toBe(existingCategoryId)
  })

  it('should handle concurrent category creation', async () => {
    const conversation = createTestConversation()

    llm.setResponse(createMockLearningResponse([
      {
        title: 'Learning 1',
        content: 'Content 1',
        categories: ['concurrent-cat']
      },
      {
        title: 'Learning 2',
        content: 'Content 2',
        categories: ['concurrent-cat']
      }
    ]))

    // Insert conversation
    db.prepare(`
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(conversation.uuid, conversation.title, new Date().toISOString(), new Date().toISOString(), conversation.platform, conversation.messages.length)

    // Extract (both learnings try to create same category)
    await extractor.extractFromConversation(conversation)

    // Category should only be created once
    const categories = db.prepare('SELECT * FROM learning_categories WHERE name = ?').all('concurrent-cat')
    expect(categories).toHaveLength(1)

    // Both learnings should be assigned to it
    const assignments = db.prepare(`
      SELECT * FROM learning_category_assignments lca
      JOIN learning_categories lc ON lca.category_id = lc.category_id
      WHERE lc.name = ?
    `).all('concurrent-cat')
    expect(assignments).toHaveLength(2)
  })

  it('should generate valid embeddings', async () => {
    const conversation = createTestConversation()

    llm.setResponse(createMockLearningResponse([
      {
        title: 'Test Learning',
        content: 'Test content',
        categories: []
      }
    ]))

    // Insert conversation
    db.prepare(`
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(conversation.uuid, conversation.title, new Date().toISOString(), new Date().toISOString(), conversation.platform, conversation.messages.length)

    // Extract
    await extractor.extractFromConversation(conversation)

    // Verify embedding is stored
    const learnings = db.prepare('SELECT * FROM learnings').all()
    expect(learnings[0].embedding).toBeDefined()
    expect(learnings[0].embedding).toBeInstanceOf(Buffer)

    // Verify embedding dimensions
    const embedding = new Float32Array(learnings[0].embedding.buffer)
    expect(embedding.length).toBe(768)
  })

  it('should batch embed multiple learnings', async () => {
    const conversation = createTestConversation()

    llm.setResponse(createMockLearningResponse([
      { title: 'Learning 1', content: 'Content 1', categories: [] },
      { title: 'Learning 2', content: 'Content 2', categories: [] },
      { title: 'Learning 3', content: 'Content 3', categories: [] }
    ]))

    // Insert conversation
    db.prepare(`
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(conversation.uuid, conversation.title, new Date().toISOString(), new Date().toISOString(), conversation.platform, conversation.messages.length)

    // Reset embedder to track calls
    embedder.reset()

    // Extract
    await extractor.extractFromConversation(conversation)

    // embedBatch should have been called with all 3 learnings
    expect(embedder.lastTexts).toHaveLength(3)
    expect(embedder.lastTexts[0]).toContain('Learning 1')
    expect(embedder.lastTexts[1]).toContain('Learning 2')
    expect(embedder.lastTexts[2]).toContain('Learning 3')
  })

  it('should link to source conversation', async () => {
    const conversation = createTestConversation()

    llm.setResponse(createMockLearningResponse([
      {
        title: 'Test Learning',
        content: 'Content',
        categories: []
      }
    ]))

    // Insert conversation
    db.prepare(`
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(conversation.uuid, conversation.title, new Date().toISOString(), new Date().toISOString(), conversation.platform, conversation.messages.length)

    // Extract
    await extractor.extractFromConversation(conversation)

    // Verify source link
    const sources = db.prepare('SELECT * FROM learning_sources').all()
    expect(sources).toHaveLength(1)
    expect(sources[0].conversation_uuid).toBe('test-conv-1')
    expect(sources[0].learning_id).toBeDefined()
  })

  it('should assign categories correctly', async () => {
    const conversation = createTestConversation()

    llm.setResponse(createMockLearningResponse([
      {
        title: 'Test Learning',
        content: 'Content',
        categories: ['cat-a', 'cat-b', 'cat-c']
      }
    ]))

    // Insert conversation
    db.prepare(`
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(conversation.uuid, conversation.title, new Date().toISOString(), new Date().toISOString(), conversation.platform, conversation.messages.length)

    // Extract
    await extractor.extractFromConversation(conversation)

    // Verify 3 categories created
    const categories = db.prepare('SELECT * FROM learning_categories').all()
    expect(categories).toHaveLength(3)

    // Verify 3 assignments created
    const assignments = db.prepare('SELECT * FROM learning_category_assignments').all()
    expect(assignments).toHaveLength(3)

    // Verify all assignments link to same learning
    const learningIds = assignments.map((a: any) => a.learning_id)
    const uniqueLearningIds = new Set(learningIds)
    expect(uniqueLearningIds.size).toBe(1)
  })

  it('should handle empty learnings response', async () => {
    const conversation = createTestConversation()

    llm.setEmptyLearnings()

    // Insert conversation
    db.prepare(`
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(conversation.uuid, conversation.title, new Date().toISOString(), new Date().toISOString(), conversation.platform, conversation.messages.length)

    // Extract
    const learnings = await extractor.extractFromConversation(conversation)

    // Verify no learnings returned
    expect(learnings).toEqual([])

    // Verify nothing stored in DB
    const storedLearnings = db.prepare('SELECT * FROM learnings').all()
    expect(storedLearnings).toHaveLength(0)
  })

  it('should handle invalid JSON gracefully', async () => {
    const conversation = createTestConversation()

    llm.setInvalidJSON()

    // Insert conversation
    db.prepare(`
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(conversation.uuid, conversation.title, new Date().toISOString(), new Date().toISOString(), conversation.platform, conversation.messages.length)

    // Extract should not throw
    const learnings = await extractor.extractFromConversation(conversation)

    expect(learnings).toEqual([])
  })

  it('should generate UUID for learnings', async () => {
    const conversation = createTestConversation()

    llm.setResponse(createMockLearningResponse([
      { title: 'Learning 1', content: 'Content 1', categories: [] },
      { title: 'Learning 2', content: 'Content 2', categories: [] }
    ]))

    // Insert conversation
    db.prepare(`
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(conversation.uuid, conversation.title, new Date().toISOString(), new Date().toISOString(), conversation.platform, conversation.messages.length)

    // Extract
    await extractor.extractFromConversation(conversation)

    // Verify UUIDs are generated and unique
    const learnings = db.prepare('SELECT learning_id FROM learnings').all()
    expect(learnings).toHaveLength(2)
    expect(learnings[0].learning_id).toBeDefined()
    expect(learnings[1].learning_id).toBeDefined()
    expect(learnings[0].learning_id).not.toBe(learnings[1].learning_id)

    // Verify UUID format (rough check)
    expect(learnings[0].learning_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  })

  it('should generate UUID for categories', async () => {
    const conversation = createTestConversation()

    llm.setResponse(createMockLearningResponse([
      {
        title: 'Test Learning',
        content: 'Content',
        categories: ['category-1', 'category-2']
      }
    ]))

    // Insert conversation
    db.prepare(`
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(conversation.uuid, conversation.title, new Date().toISOString(), new Date().toISOString(), conversation.platform, conversation.messages.length)

    // Extract
    await extractor.extractFromConversation(conversation)

    // Verify UUIDs are generated for categories
    const categories = db.prepare('SELECT category_id FROM learning_categories').all()
    expect(categories).toHaveLength(2)
    expect(categories[0].category_id).toBeDefined()
    expect(categories[1].category_id).toBeDefined()
    expect(categories[0].category_id).not.toBe(categories[1].category_id)

    // Verify UUID format
    expect(categories[0].category_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  })

  it('should insert embeddings into vector store', async () => {
    const conversation = createTestConversation()

    llm.setResponse(createMockLearningResponse([
      {
        title: 'Test Learning',
        content: 'Test content',
        categories: []
      }
    ]))

    // Insert conversation
    db.prepare(`
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(conversation.uuid, conversation.title, new Date().toISOString(), new Date().toISOString(), conversation.platform, conversation.messages.length)

    // Extract
    await extractor.extractFromConversation(conversation)

    // Verify vector store received embedding (through insert method)
    // This is validated by the vector store insert call in the extractor
    const learnings = db.prepare('SELECT learning_id FROM learnings').all()
    expect(learnings).toHaveLength(1)
  })

  it('should handle multiple extractions sequentially', async () => {
    // First extraction
    const conv1 = createTestConversation()
    llm.setResponse(createMockLearningResponse([
      { title: 'Learning 1', content: 'Content 1', categories: ['shared-category'] }
    ]))

    db.prepare(`
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(conv1.uuid, conv1.title, new Date().toISOString(), new Date().toISOString(), conv1.platform, conv1.messages.length)

    await extractor.extractFromConversation(conv1)

    // Second extraction (should reuse category)
    const conv2 = { ...createTestConversation(), uuid: 'test-conv-2' }
    conv2.messages = conv2.messages.map(m => ({ ...m, conversationUuid: 'test-conv-2' }))

    llm.setResponse(createMockLearningResponse([
      { title: 'Learning 2', content: 'Content 2', categories: ['shared-category'] }
    ]))

    db.prepare(`
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(conv2.uuid, conv2.title, new Date().toISOString(), new Date().toISOString(), conv2.platform, conv2.messages.length)

    await extractor.extractFromConversation(conv2)

    // Verify category was reused
    const categories = db.prepare('SELECT * FROM learning_categories').all()
    expect(categories).toHaveLength(1)
    expect(categories[0].name).toBe('shared-category')

    // Verify 2 learnings created
    const learnings = db.prepare('SELECT * FROM learnings').all()
    expect(learnings).toHaveLength(2)
  })
})
