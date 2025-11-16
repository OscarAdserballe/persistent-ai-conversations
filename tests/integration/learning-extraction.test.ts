import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { unlinkSync, existsSync } from 'fs'
import { join } from 'path'
import { createDatabase } from '../../src/factories'
import { getRawDb, type DrizzleDB } from '../../src/db/client'
import { SqliteVectorStore } from '../../src/db/vector-store'
import { LearningExtractorImpl } from '../../src/services/learning-extractor'
import { MockLLMModel, MockEmbeddingModel, createMockLearnings } from '../../src/mocks'
import type { Conversation } from '../../src/core/types'

describe('Learning Extraction Pipeline', () => {
  const testDbPath = join(__dirname, '../tmp/learning-extraction-test.db')

  let drizzleDb: DrizzleDB
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
    drizzleDb = createDatabase(testDbPath)

    // Create mocks
    llm = new MockLLMModel()
    embedder = new MockEmbeddingModel()

    // Create vector store and initialize
    vectorStore = new SqliteVectorStore(getRawDb(drizzleDb))
    vectorStore.initialize(embedder.dimensions)

    // Create extractor (no vector store parameter needed)
    extractor = new LearningExtractorImpl(llm, embedder, drizzleDb)
  })

  afterEach(() => {
    getRawDb(drizzleDb).close()
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

    // Configure LLM to return a learning with new schema
    llm.setStructuredResponse(createMockLearnings([
      {
        title: 'TypeScript Introduction',
        tags: ['programming', 'typescript']
      }
    ]))

    // Insert conversation into DB
    getRawDb(drizzleDb).prepare(`
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(conversation.uuid, conversation.title, new Date().toISOString(), new Date().toISOString(), conversation.platform, conversation.messages.length)

    // Extract learnings
    const learnings = await extractor.extractFromConversation(conversation)

    // Verify learnings were returned
    expect(learnings).toHaveLength(1)
    expect(learnings[0].title).toBe('TypeScript Introduction')
    expect(learnings[0].tags).toContain('programming')
    expect(learnings[0].tags).toContain('typescript')

    // Verify learnings table
    const storedLearnings = getRawDb(drizzleDb).prepare('SELECT * FROM learnings').all() as any[]
    expect(storedLearnings).toHaveLength(1)
    expect(storedLearnings[0].title).toBe('TypeScript Introduction')

    // Verify tags are stored as JSON
    const tags = JSON.parse(storedLearnings[0].tags)
    expect(tags).toContain('programming')
    expect(tags).toContain('typescript')

    // Verify conversation link
    expect(storedLearnings[0].conversation_uuid).toBe('test-conv-1')
  })

  it('should store tags as JSON array', async () => {
    const conversation = createTestConversation()

    llm.setStructuredResponse(createMockLearnings([
      {
        title: 'Test Learning',
        tags: ['tag1', 'tag2', 'tag3']
      }
    ]))

    // Insert conversation
    getRawDb(drizzleDb).prepare(`
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(conversation.uuid, conversation.title, new Date().toISOString(), new Date().toISOString(), conversation.platform, conversation.messages.length)

    // Extract
    const learnings = await extractor.extractFromConversation(conversation)

    // Verify tags in returned learning
    expect(learnings[0].tags).toHaveLength(3)
    expect(learnings[0].tags).toContain('tag1')

    // Verify tags in database
    const storedLearnings = getRawDb(drizzleDb).prepare('SELECT tags FROM learnings').all() as any[]
    const tags = JSON.parse(storedLearnings[0].tags)
    expect(tags).toHaveLength(3)
  })

  it('should handle learnings without tags', async () => {
    const conversation = createTestConversation()

    llm.setStructuredResponse(createMockLearnings([
      {
        title: 'Test Learning',
        tags: []
      }
    ]))

    // Insert conversation
    getRawDb(drizzleDb).prepare(`
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(conversation.uuid, conversation.title, new Date().toISOString(), new Date().toISOString(), conversation.platform, conversation.messages.length)

    // Extract
    const learnings = await extractor.extractFromConversation(conversation)

    // Verify empty tags array
    expect(learnings[0].tags).toEqual([])
  })

  it('should handle multiple learnings with shared tags', async () => {
    const conversation = createTestConversation()

    llm.setStructuredResponse(createMockLearnings([
      {
        title: 'Learning 1',
        tags: ['shared-tag', 'tag1']
      },
      {
        title: 'Learning 2',
        tags: ['shared-tag', 'tag2']
      }
    ]))

    // Insert conversation
    getRawDb(drizzleDb).prepare(`
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(conversation.uuid, conversation.title, new Date().toISOString(), new Date().toISOString(), conversation.platform, conversation.messages.length)

    // Extract
    const learnings = await extractor.extractFromConversation(conversation)

    // Verify both learnings have the shared tag
    expect(learnings).toHaveLength(2)
    expect(learnings[0].tags).toContain('shared-tag')
    expect(learnings[1].tags).toContain('shared-tag')
  })

  it('should generate valid embeddings', async () => {
    const conversation = createTestConversation()

    llm.setStructuredResponse(createMockLearnings([
      {
        title: 'Test Learning',
        tags: []
      }
    ]))

    // Insert conversation
    getRawDb(drizzleDb).prepare(`
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(conversation.uuid, conversation.title, new Date().toISOString(), new Date().toISOString(), conversation.platform, conversation.messages.length)

    // Extract
    await extractor.extractFromConversation(conversation)

    // Verify embedding is stored
    const learnings = getRawDb(drizzleDb).prepare('SELECT * FROM learnings').all()
    expect(learnings[0].embedding).toBeDefined()
    expect(learnings[0].embedding).toBeInstanceOf(Buffer)

    // Verify embedding dimensions
    const embedding = new Float32Array(learnings[0].embedding.buffer)
    expect(embedding.length).toBe(768)
  })

  it('should batch embed multiple learnings', async () => {
    const conversation = createTestConversation()

    llm.setStructuredResponse(createMockLearnings([
      { title: 'Learning 1', tags: [] },
      { title: 'Learning 2', tags: [] },
      { title: 'Learning 3', tags: [] }
    ]))

    // Insert conversation
    getRawDb(drizzleDb).prepare(`
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

    llm.setStructuredResponse(createMockLearnings([
      {
        title: 'Test Learning',
        tags: []
      }
    ]))

    // Insert conversation
    getRawDb(drizzleDb).prepare(`
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(conversation.uuid, conversation.title, new Date().toISOString(), new Date().toISOString(), conversation.platform, conversation.messages.length)

    // Extract
    const learnings = await extractor.extractFromConversation(conversation)

    // Verify source link in returned learning
    expect(learnings[0].conversationUuid).toBe('test-conv-1')

    // Verify stored in database
    const storedLearnings = getRawDb(drizzleDb).prepare('SELECT conversation_uuid FROM learnings').all() as any[]
    expect(storedLearnings[0].conversation_uuid).toBe('test-conv-1')
  })

  it('should store advanced schema fields', async () => {
    const conversation = createTestConversation()

    llm.setStructuredResponse(createMockLearnings([
      {
        title: 'Test Learning',
        tags: ['tag-a', 'tag-b', 'tag-c']
      }
    ]))

    // Insert conversation
    getRawDb(drizzleDb).prepare(`
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(conversation.uuid, conversation.title, new Date().toISOString(), new Date().toISOString(), conversation.platform, conversation.messages.length)

    // Extract
    const learnings = await extractor.extractFromConversation(conversation)

    // Verify advanced schema fields are present
    expect(learnings[0].abstraction).toBeDefined()
    expect(learnings[0].abstraction.concrete).toBeDefined()
    expect(learnings[0].abstraction.pattern).toBeDefined()
    expect(learnings[0].understanding).toBeDefined()
    expect(learnings[0].understanding.confidence).toBeGreaterThan(0)
    expect(learnings[0].effort).toBeDefined()
    expect(learnings[0].resonance).toBeDefined()
  })

  it('should handle empty learnings response', async () => {
    const conversation = createTestConversation()

    llm.setEmptyLearnings()

    // Insert conversation
    getRawDb(drizzleDb).prepare(`
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(conversation.uuid, conversation.title, new Date().toISOString(), new Date().toISOString(), conversation.platform, conversation.messages.length)

    // Extract
    const learnings = await extractor.extractFromConversation(conversation)

    // Verify no learnings returned
    expect(learnings).toEqual([])

    // Verify nothing stored in DB
    const storedLearnings = getRawDb(drizzleDb).prepare('SELECT * FROM learnings').all()
    expect(storedLearnings).toHaveLength(0)
  })

  it('should throw ZodError for invalid structured output', async () => {
    const conversation = createTestConversation()

    // Set invalid structured response (missing required fields)
    llm.setStructuredResponse([{ invalid: 'data' }])

    // Insert conversation
    getRawDb(drizzleDb).prepare(`
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(conversation.uuid, conversation.title, new Date().toISOString(), new Date().toISOString(), conversation.platform, conversation.messages.length)

    // Extract should throw ZodError
    await expect(extractor.extractFromConversation(conversation)).rejects.toThrow()
  })

  it('should generate UUID for learnings', async () => {
    const conversation = createTestConversation()

    llm.setStructuredResponse(createMockLearnings([
      { title: 'Learning 1', tags: [] },
      { title: 'Learning 2', tags: [] }
    ]))

    // Insert conversation
    getRawDb(drizzleDb).prepare(`
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(conversation.uuid, conversation.title, new Date().toISOString(), new Date().toISOString(), conversation.platform, conversation.messages.length)

    // Extract
    await extractor.extractFromConversation(conversation)

    // Verify UUIDs are generated and unique
    const learnings = getRawDb(drizzleDb).prepare('SELECT learning_id FROM learnings').all()
    expect(learnings).toHaveLength(2)
    expect(learnings[0].learning_id).toBeDefined()
    expect(learnings[1].learning_id).toBeDefined()
    expect(learnings[0].learning_id).not.toBe(learnings[1].learning_id)

    // Verify UUID format (rough check)
    expect(learnings[0].learning_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  })

  it('should store embeddings in database', async () => {
    const conversation = createTestConversation()

    llm.setStructuredResponse(createMockLearnings([
      {
        title: 'Test Learning',
        tags: []
      }
    ]))

    // Insert conversation
    getRawDb(drizzleDb).prepare(`
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(conversation.uuid, conversation.title, new Date().toISOString(), new Date().toISOString(), conversation.platform, conversation.messages.length)

    // Extract
    await extractor.extractFromConversation(conversation)

    // Verify embeddings stored in database
    const learnings = getRawDb(drizzleDb).prepare('SELECT learning_id, embedding FROM learnings').all()
    expect(learnings).toHaveLength(1)
    expect(learnings[0].embedding).toBeDefined()
  })

  it('should handle multiple extractions sequentially', async () => {
    // First extraction
    const conv1 = createTestConversation()
    llm.setStructuredResponse(createMockLearnings([
      { title: 'Learning 1', tags: ['shared-tag'] }
    ]))

    getRawDb(drizzleDb).prepare(`
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(conv1.uuid, conv1.title, new Date().toISOString(), new Date().toISOString(), conv1.platform, conv1.messages.length)

    await extractor.extractFromConversation(conv1)

    // Second extraction
    const conv2 = { ...createTestConversation(), uuid: 'test-conv-2' }
    conv2.messages = conv2.messages.map(m => ({ ...m, conversationUuid: 'test-conv-2' }))

    llm.setStructuredResponse(createMockLearnings([
      { title: 'Learning 2', tags: ['shared-tag'] }
    ]))

    getRawDb(drizzleDb).prepare(`
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(conv2.uuid, conv2.title, new Date().toISOString(), new Date().toISOString(), conv2.platform, conv2.messages.length)

    await extractor.extractFromConversation(conv2)

    // Verify 2 learnings created
    const learnings = getRawDb(drizzleDb).prepare('SELECT * FROM learnings').all()
    expect(learnings).toHaveLength(2)

    // Both can have same tag (no deduplication needed for tags)
    const learning1 = await extractor.extractFromConversation(conv1)
    // Just verify both were stored
    expect(learnings).toHaveLength(2)
  })
})
