import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { unlinkSync, existsSync, writeFileSync, readFileSync } from 'fs'
import { join } from 'path'
import { createDatabase, closeDatabase } from '../../src/db/database'
import { SqliteVectorStore } from '../../src/db/vector-store'
import { LearningExtractorImpl } from '../../src/services/learning-extractor'
import { LearningSearchImpl } from '../../src/services/learning-search'
import { MockLLMModel, MockEmbeddingModel, createMockLearningResponse } from '../mocks'
import Database from 'better-sqlite3'
import type { Conversation } from '../../src/core/types'

describe('Learning Workflow E2E', () => {
  const testDbPath = join(__dirname, '../tmp/learning-workflow-e2e-test.db')
  const diaryPath = join(__dirname, '../tmp/test-diary.md')

  let db: Database.Database
  let vectorStore: SqliteVectorStore
  let llm: MockLLMModel
  let embedder: MockEmbeddingModel
  let extractor: LearningExtractorImpl
  let search: LearningSearchImpl

  beforeEach(() => {
    // Clean up any existing files
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath)
    }
    if (existsSync(diaryPath)) {
      unlinkSync(diaryPath)
    }

    // Create fresh database
    db = createDatabase(testDbPath)

    // Create mocks
    llm = new MockLLMModel()
    embedder = new MockEmbeddingModel()

    // Create vector store
    vectorStore = new SqliteVectorStore(db)
    vectorStore.initialize(embedder.dimensions)

    // Create extractor and search
    extractor = new LearningExtractorImpl(llm, embedder, vectorStore, db)
    search = new LearningSearchImpl(embedder, vectorStore, db)
  })

  afterEach(() => {
    closeDatabase(db)
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath)
    }
    if (existsSync(diaryPath)) {
      unlinkSync(diaryPath)
    }
  })

  const createConversation = (id: string, title: string, content: string): Conversation => ({
    uuid: id,
    title,
    platform: 'claude',
    messages: [
      {
        uuid: `${id}-msg-1`,
        conversationUuid: id,
        conversationIndex: 0,
        sender: 'human' as const,
        text: `Tell me about ${content}`,
        createdAt: new Date(),
        metadata: {}
      },
      {
        uuid: `${id}-msg-2`,
        conversationUuid: id,
        conversationIndex: 1,
        sender: 'assistant' as const,
        text: `Here's information about ${content}...`,
        createdAt: new Date(),
        metadata: {}
      }
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
    metadata: {}
  })

  it('should complete full workflow: ingest → extract → search', async () => {
    // 1. Ingest conversations (simulate)
    const conversation = createConversation('conv-1', 'TypeScript Tutorial', 'TypeScript')

    db.prepare(`
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(conversation.uuid, conversation.title, new Date().toISOString(), new Date().toISOString(), conversation.platform, conversation.messages.length)

    // 2. Extract learnings
    llm.setResponse(createMockLearningResponse([
      {
        title: 'TypeScript Basics',
        content: 'TypeScript adds static typing to JavaScript for better developer experience.',
        categories: ['programming', 'typescript']
      }
    ]))

    const learnings = await extractor.extractFromConversation(conversation)

    expect(learnings).toHaveLength(1)
    expect(learnings[0].title).toBe('TypeScript Basics')

    // 3. Search learnings
    const results = await search.search('TypeScript', { limit: 10 })

    expect(results.length).toBeGreaterThan(0)
    expect(results[0].learning.title).toBe('TypeScript Basics')
    expect(results[0].learning.categories.length).toBe(2)
    expect(results[0].sourceConversations[0].title).toBe('TypeScript Tutorial')
  })

  it('should handle extraction with no learnings', async () => {
    const conversation = createConversation('conv-1', 'Casual Chat', 'nothing important')

    db.prepare(`
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(conversation.uuid, conversation.title, new Date().toISOString(), new Date().toISOString(), conversation.platform, conversation.messages.length)

    // LLM returns empty array (no learnings)
    llm.setEmptyLearnings()

    const learnings = await extractor.extractFromConversation(conversation)

    expect(learnings).toEqual([])

    // Verify nothing in DB
    const storedLearnings = db.prepare('SELECT * FROM learnings').all()
    expect(storedLearnings).toHaveLength(0)
  })

  it('should handle partial extraction failures', async () => {
    // Insert 3 conversations
    const conversations = [
      createConversation('conv-1', 'TypeScript', 'TypeScript'),
      createConversation('conv-2', 'React', 'React'),
      createConversation('conv-3', 'Invalid', 'Invalid')
    ]

    for (const conv of conversations) {
      db.prepare(`
        INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(conv.uuid, conv.title, new Date().toISOString(), new Date().toISOString(), conv.platform, conv.messages.length)
    }

    // First two succeed, third returns invalid JSON
    const responses = [
      createMockLearningResponse([{ title: 'TS Learning', content: 'TS content', categories: [] }]),
      createMockLearningResponse([{ title: 'React Learning', content: 'React content', categories: [] }]),
      'invalid json'
    ]
    llm.setResponses(responses)

    // Extract from all 3
    const results = await Promise.all(
      conversations.map(conv => extractor.extractFromConversation(conv))
    )

    // Verify 2 successes and 1 failure (empty array)
    expect(results[0]).toHaveLength(1)
    expect(results[1]).toHaveLength(1)
    expect(results[2]).toEqual([])

    // Verify 2 learnings in DB
    const storedLearnings = db.prepare('SELECT * FROM learnings').all()
    expect(storedLearnings).toHaveLength(2)
  })

  it('should generate valid markdown diary', async () => {
    // Extract some learnings
    const conversation = createConversation('conv-1', 'Programming Tutorial', 'programming')

    db.prepare(`
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(conversation.uuid, conversation.title, new Date().toISOString(), new Date().toISOString(), conversation.platform, conversation.messages.length)

    llm.setResponse(createMockLearningResponse([
      {
        title: 'TypeScript Types',
        content: 'TypeScript provides static typing for JavaScript.',
        categories: ['typescript', 'programming']
      },
      {
        title: 'React Hooks',
        content: 'React Hooks allow state in functional components.',
        categories: ['react', 'programming']
      }
    ]))

    const learnings = await extractor.extractFromConversation(conversation)

    // Generate markdown diary
    const diary = generateMarkdownDiary(learnings, new Date('2025-01-01'), new Date())
    writeFileSync(diaryPath, diary)

    // Verify diary was created
    expect(existsSync(diaryPath)).toBe(true)

    // Read and verify content
    const diaryContent = readFileSync(diaryPath, 'utf-8')

    expect(diaryContent).toContain('# Learning Diary')
    expect(diaryContent).toContain('TypeScript Types')
    expect(diaryContent).toContain('React Hooks')
    expect(diaryContent).toContain('**Categories:**')
    expect(diaryContent).toContain('typescript, programming')
    expect(diaryContent).toContain('react, programming')
    expect(diaryContent).toContain('**Sources:**')
    expect(diaryContent).toContain(conversation.uuid)
  })

  it('should handle incremental extraction', async () => {
    // First extraction creates categories
    const conv1 = createConversation('conv-1', 'TypeScript Tutorial', 'TypeScript')

    db.prepare(`
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(conv1.uuid, conv1.title, new Date().toISOString(), new Date().toISOString(), conv1.platform, conv1.messages.length)

    llm.setResponse(createMockLearningResponse([
      {
        title: 'TypeScript Basics',
        content: 'TypeScript content',
        categories: ['programming', 'typescript']
      }
    ]))

    await extractor.extractFromConversation(conv1)

    // Verify categories were created
    const categoriesAfterFirst = db.prepare('SELECT * FROM learning_categories').all()
    expect(categoriesAfterFirst).toHaveLength(2)

    // Second extraction reuses categories
    const conv2 = createConversation('conv-2', 'TypeScript Advanced', 'advanced TypeScript')

    db.prepare(`
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(conv2.uuid, conv2.title, new Date().toISOString(), new Date().toISOString(), conv2.platform, conv2.messages.length)

    llm.setResponse(createMockLearningResponse([
      {
        title: 'TypeScript Generics',
        content: 'Generics provide type safety',
        categories: ['programming', 'typescript']  // Same categories
      }
    ]))

    await extractor.extractFromConversation(conv2)

    // Verify categories were reused (still only 2)
    const categoriesAfterSecond = db.prepare('SELECT * FROM learning_categories').all()
    expect(categoriesAfterSecond).toHaveLength(2)

    // Verify 2 learnings created
    const learnings = db.prepare('SELECT * FROM learnings').all()
    expect(learnings).toHaveLength(2)
  })

  it('should support searching extracted learnings', async () => {
    // Extract learnings about different topics
    const conversations = [
      createConversation('conv-1', 'TypeScript Tutorial', 'TypeScript'),
      createConversation('conv-2', 'Python Guide', 'Python')
    ]

    for (const conv of conversations) {
      db.prepare(`
        INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(conv.uuid, conv.title, new Date().toISOString(), new Date().toISOString(), conv.platform, conv.messages.length)
    }

    // Set up responses for both extractions
    llm.setResponses([
      createMockLearningResponse([
        {
          title: 'TypeScript Introduction',
          content: 'TypeScript is a typed superset of JavaScript.',
          categories: ['typescript', 'programming']
        }
      ]),
      createMockLearningResponse([
        {
          title: 'Python Basics',
          content: 'Python is a high-level programming language.',
          categories: ['python', 'programming']
        }
      ])
    ])

    // Extract from both
    await extractor.extractFromConversation(conversations[0])
    await extractor.extractFromConversation(conversations[1])

    // Search for TypeScript
    const tsResults = await search.search('TypeScript', { limit: 10 })

    expect(tsResults.length).toBeGreaterThan(0)
    expect(tsResults[0].learning.title).toContain('TypeScript')
    expect(tsResults[0].score).toBeGreaterThan(0)

    // Search for Python
    const pyResults = await search.search('Python', { limit: 10 })

    expect(pyResults.length).toBeGreaterThan(0)
    // Note: Mock embedder doesn't guarantee exact semantic matching, so just verify Python learning exists
    const hasPythonResult = pyResults.some(r => r.learning.title.includes('Python'))
    expect(hasPythonResult).toBe(true)
  })

  it('should link learnings back to source conversations', async () => {
    const conversation = createConversation('conv-source', 'Original Discussion', 'TypeScript')

    db.prepare(`
      INSERT INTO conversations (uuid, name, summary, created_at, updated_at, platform, message_count)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(conversation.uuid, conversation.title, 'A detailed discussion', new Date().toISOString(), new Date().toISOString(), conversation.platform, conversation.messages.length)

    llm.setResponse(createMockLearningResponse([
      {
        title: 'TypeScript Learning',
        content: 'Content about TypeScript',
        categories: []
      }
    ]))

    // Extract
    const learnings = await extractor.extractFromConversation(conversation)

    // Search
    const results = await search.search('TypeScript', { limit: 10 })

    expect(results.length).toBeGreaterThan(0)

    // Verify source link
    const source = results[0].sourceConversations[0]
    expect(source.uuid).toBe('conv-source')
    expect(source.title).toBe('Original Discussion')

    // Verify we can query the original conversation
    const originalConv = db.prepare('SELECT * FROM conversations WHERE uuid = ?').get('conv-source')
    expect(originalConv).toBeDefined()
    expect(originalConv.name).toBe('Original Discussion')
    expect(originalConv.summary).toBe('A detailed discussion')
  })

  it('should handle large-scale extraction', async () => {
    // Simulate extracting from 50 conversations
    const conversations: Conversation[] = []

    for (let i = 0; i < 50; i++) {
      const conv = createConversation(`conv-${i}`, `Conversation ${i}`, `topic ${i}`)
      conversations.push(conv)

      db.prepare(`
        INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(conv.uuid, conv.title, new Date().toISOString(), new Date().toISOString(), conv.platform, conv.messages.length)
    }

    // Configure LLM to return 1-2 learnings per conversation
    llm.setResponse(createMockLearningResponse([
      {
        title: 'Learning from conversation',
        content: 'Some learning content',
        categories: ['programming']
      }
    ]))

    // Extract from all (with performance timing)
    const startTime = Date.now()

    for (const conv of conversations) {
      await extractor.extractFromConversation(conv)
    }

    const endTime = Date.now()
    const duration = endTime - startTime

    // Verify all learnings were created
    const learnings = db.prepare('SELECT * FROM learnings').all()
    expect(learnings.length).toBe(50)

    // Verify single category was reused across all
    const categories = db.prepare('SELECT * FROM learning_categories').all()
    expect(categories).toHaveLength(1)

    // Verify all assignments
    const assignments = db.prepare('SELECT * FROM learning_category_assignments').all()
    expect(assignments).toHaveLength(50)

    // Performance check: should complete in reasonable time (< 5 seconds for 50 extractions with mocks)
    expect(duration).toBeLessThan(5000)

    // Verify data consistency
    const sources = db.prepare('SELECT * FROM learning_sources').all()
    expect(sources).toHaveLength(50)
  })

  it('should handle complex category relationships', async () => {
    const conv = createConversation('conv-1', 'Full Stack Development', 'full stack')

    db.prepare(`
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(conv.uuid, conv.title, new Date().toISOString(), new Date().toISOString(), conv.platform, conv.messages.length)

    llm.setResponse(createMockLearningResponse([
      {
        title: 'Frontend Frameworks',
        content: 'React and Vue are popular frontend frameworks',
        categories: ['frontend', 'javascript', 'frameworks']
      },
      {
        title: 'Backend APIs',
        content: 'REST and GraphQL are common API patterns',
        categories: ['backend', 'api', 'architecture']
      },
      {
        title: 'Database Design',
        content: 'SQL and NoSQL databases have different use cases',
        categories: ['database', 'backend', 'architecture']
      }
    ]))

    await extractor.extractFromConversation(conv)

    // Verify all unique categories were created
    const categories = db.prepare('SELECT * FROM learning_categories ORDER BY name').all()
    const categoryNames = categories.map((c: any) => c.name)
    expect(categoryNames).toEqual(['api', 'architecture', 'backend', 'database', 'frameworks', 'frontend', 'javascript'])

    // Verify category overlap (backend and architecture appear in multiple learnings)
    const backendAssignments = db.prepare(`
      SELECT COUNT(*) as count FROM learning_category_assignments lca
      JOIN learning_categories lc ON lca.category_id = lc.category_id
      WHERE lc.name = 'backend'
    `).get() as any

    expect(backendAssignments.count).toBe(2)

    const architectureAssignments = db.prepare(`
      SELECT COUNT(*) as count FROM learning_category_assignments lca
      JOIN learning_categories lc ON lca.category_id = lc.category_id
      WHERE lc.name = 'architecture'
    `).get() as any

    expect(architectureAssignments.count).toBe(2)
  })
})

// Helper function to generate markdown diary
function generateMarkdownDiary(
  learnings: Array<{ title: string; content: string; categories: Array<{ name: string }>; sources: Array<{ conversationUuid: string }>; createdAt: Date }>,
  start: Date,
  end: Date
): string {
  let md = `# Learning Diary\n\n`
  md += `**Period:** ${start.toISOString().split('T')[0]} to ${end.toISOString().split('T')[0]}\n`
  md += `**Total Learnings:** ${learnings.length}\n\n`
  md += `---\n\n`

  // Group by date
  const byDate = new Map<string, typeof learnings>()
  for (const learning of learnings) {
    const dateKey = learning.createdAt.toISOString().split('T')[0]
    if (!byDate.has(dateKey)) {
      byDate.set(dateKey, [])
    }
    byDate.get(dateKey)!.push(learning)
  }

  // Sort dates descending
  const sortedDates = Array.from(byDate.keys()).sort().reverse()

  for (const date of sortedDates) {
    const dateLearnings = byDate.get(date)!
    md += `## ${date}\n\n`

    for (const learning of dateLearnings) {
      md += `### ${learning.title}\n\n`

      if (learning.categories.length > 0) {
        const categoryNames = learning.categories.map(c => c.name).join(', ')
        md += `**Categories:** ${categoryNames}\n\n`
      }

      md += `${learning.content}\n\n`

      if (learning.sources.length > 0) {
        md += `**Sources:**\n`
        for (const source of learning.sources) {
          md += `- Conversation: \`${source.conversationUuid}\`\n`
        }
        md += `\n`
      }

      md += `---\n\n`
    }
  }

  return md
}
