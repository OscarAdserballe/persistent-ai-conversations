import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { unlinkSync, existsSync, writeFileSync } from 'fs'
import { join } from 'path'
import { execSync } from 'child_process'
import { createDefaultConfig } from '../../src/config'
import { createDatabase } from '../../src/factories'
import { getRawDb } from '../../src/db/client'

describe('Full Workflow E2E', () => {
  const testDbPath = join(__dirname, '../tmp/e2e-workflow-test.db')
  const testConfigPath = join(__dirname, '../tmp/e2e-workflow-config.json')
  const minimalFixturePath = join(__dirname, '../fixtures/conversations/minimal.json')

  beforeEach(() => {
    // Clean up any existing test files
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath)
    }
    if (existsSync(testDbPath + '-shm')) {
      unlinkSync(testDbPath + '-shm')
    }
    if (existsSync(testDbPath + '-wal')) {
      unlinkSync(testDbPath + '-wal')
    }
    if (existsSync(testConfigPath)) {
      unlinkSync(testConfigPath)
    }

    // Create test config
    const testConfig = {
      ...createDefaultConfig(),
      db: { path: testDbPath },
      ingestion: {
        batchSize: 10,
        progressLogging: false
      }
    }

    writeFileSync(testConfigPath, JSON.stringify(testConfig, null, 2))
  })

  afterEach(() => {
    // Clean up test files
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath)
    }
    if (existsSync(testDbPath + '-shm')) {
      unlinkSync(testDbPath + '-shm')
    }
    if (existsSync(testDbPath + '-wal')) {
      unlinkSync(testDbPath + '-wal')
    }
    if (existsSync(testConfigPath)) {
      unlinkSync(testConfigPath)
    }
  })

  it('should complete full ingest → search workflow', () => {
    // Step 1: Verify database doesn't exist
    expect(existsSync(testDbPath)).toBe(false)

    // Step 2: Run ingestion
    const ingestOutput = execSync(
      `npx tsx src/cli/ingest.ts "${minimalFixturePath}" --config "${testConfigPath}"`,
      { encoding: 'utf-8', cwd: join(__dirname, '../..') }
    )

    expect(ingestOutput).toContain('Starting ingestion')
    expect(ingestOutput).toContain('Successfully imported')

    // Step 3: Verify database was created
    expect(existsSync(testDbPath)).toBe(true)

    // Step 4: Verify data in database
    const drizzleDb = createDatabase(testDbPath)
    const db = getRawDb(drizzleDb)

    const conversations = db.prepare('SELECT * FROM conversations').all()
    expect(conversations.length).toBeGreaterThan(0)

    const messages = db.prepare('SELECT * FROM messages').all()
    expect(messages.length).toBeGreaterThan(0)

    // Verify embeddings were stored in chunks
    const chunksWithEmbeddings = db.prepare(
      'SELECT DISTINCT message_uuid FROM message_chunks WHERE embedding IS NOT NULL'
    ).all()
    expect(chunksWithEmbeddings.length).toBe(messages.length)

    db.close()

    // Step 5: Run search on ingested data
    const searchOutput = execSync(
      `npx tsx src/cli/search.ts "Hello" --config "${testConfigPath}"`,
      { encoding: 'utf-8', cwd: join(__dirname, '../..') }
    )

    expect(searchOutput).toContain('Searching for: "Hello"')
    expect(searchOutput).toContain('result')
    expect(searchOutput).toContain('Conversation:')

    // Step 6: Run another search with different query
    const searchOutput2 = execSync(
      `npx tsx src/cli/search.ts "assistant" --config "${testConfigPath}"`,
      { encoding: 'utf-8', cwd: join(__dirname, '../..') }
    )

    expect(searchOutput2).toContain('Searching for: "assistant"')
  }, 60000) // 60 second timeout for full workflow

  it('should handle multiple conversations in workflow', () => {
    // Create a fixture with multiple conversations
    const multiConvPath = join(__dirname, '../tmp/multi-conv-workflow.json')

    const multipleConversations = [
      {
        uuid: 'conv-1',
        name: 'TypeScript Discussion',
        summary: 'Learning about TypeScript',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        chat_messages: [
          {
            uuid: 'msg-1',
            sender: 'human',
            text: 'What is TypeScript?',
            created_at: '2024-01-01T00:00:00Z',
            content: [{ type: 'text', text: 'What is TypeScript?' }]
          },
          {
            uuid: 'msg-2',
            sender: 'assistant',
            text: 'TypeScript is a typed superset of JavaScript.',
            created_at: '2024-01-01T00:01:00Z',
            content: [{ type: 'text', text: 'TypeScript is a typed superset of JavaScript.' }]
          }
        ]
      },
      {
        uuid: 'conv-2',
        name: 'Python Tutorial',
        summary: 'Learning about Python',
        created_at: '2024-01-02T00:00:00Z',
        updated_at: '2024-01-02T00:00:00Z',
        chat_messages: [
          {
            uuid: 'msg-3',
            sender: 'human',
            text: 'Tell me about Python',
            created_at: '2024-01-02T00:00:00Z',
            content: [{ type: 'text', text: 'Tell me about Python' }]
          },
          {
            uuid: 'msg-4',
            sender: 'assistant',
            text: 'Python is a high-level programming language.',
            created_at: '2024-01-02T00:01:00Z',
            content: [{ type: 'text', text: 'Python is a high-level programming language.' }]
          }
        ]
      }
    ]

    writeFileSync(multiConvPath, JSON.stringify(multipleConversations))

    try {
      // Ingest multiple conversations
      const ingestOutput = execSync(
        `npx tsx src/cli/ingest.ts "${multiConvPath}" --config "${testConfigPath}"`,
        { encoding: 'utf-8', cwd: join(__dirname, '../..') }
      )

      expect(ingestOutput).toContain('2 conversations')

      // Verify both conversations in database
      const drizzleDb = createDatabase(testDbPath)
    const db = getRawDb(drizzleDb)
      const conversations = db.prepare('SELECT * FROM conversations').all()
      expect(conversations.length).toBe(2)
      db.close()

      // Search for TypeScript
      const tsSearch = execSync(
        `npx tsx src/cli/search.ts "TypeScript" --config "${testConfigPath}"`,
        { encoding: 'utf-8', cwd: join(__dirname, '../..') }
      )

      expect(tsSearch).toContain('TypeScript Discussion')

      // Search for Python
      const pySearch = execSync(
        `npx tsx src/cli/search.ts "Python" --config "${testConfigPath}"`,
        { encoding: 'utf-8', cwd: join(__dirname, '../..') }
      )

      expect(pySearch).toContain('Python Tutorial')

    } finally {
      if (existsSync(multiConvPath)) {
        unlinkSync(multiConvPath)
      }
    }
  }, 60000)

  it('should support filtering by sender in workflow', () => {
    // Ingest data
    execSync(
      `npx tsx src/cli/ingest.ts "${minimalFixturePath}" --config "${testConfigPath}"`,
      { encoding: 'utf-8', cwd: join(__dirname, '../..') }
    )

    // Search for human messages
    const humanSearch = execSync(
      `npx tsx src/cli/search.ts "conversation" --config "${testConfigPath}" --sender human`,
      { encoding: 'utf-8', cwd: join(__dirname, '../..') }
    )

    // Should contain human messages
    expect(humanSearch).toContain('[HUMAN]:')

    // Search for assistant messages
    const assistantSearch = execSync(
      `npx tsx src/cli/search.ts "conversation" --config "${testConfigPath}" --sender assistant`,
      { encoding: 'utf-8', cwd: join(__dirname, '../..') }
    )

    // Should contain assistant messages
    expect(assistantSearch).toContain('[ASSISTANT]:')
  }, 60000)

  it('should support limiting results in workflow', () => {
    // Ingest data
    execSync(
      `npx tsx src/cli/ingest.ts "${minimalFixturePath}" --config "${testConfigPath}"`,
      { encoding: 'utf-8', cwd: join(__dirname, '../..') }
    )

    // Search with limit of 1
    const limitedSearch = execSync(
      `npx tsx src/cli/search.ts "message" --config "${testConfigPath}" --limit 1`,
      { encoding: 'utf-8', cwd: join(__dirname, '../..') }
    )

    // Count conversation headers
    const matches = limitedSearch.match(/Conversation:/g)
    expect(matches).toBeDefined()
    expect(matches!.length).toBeLessThanOrEqual(1)
  }, 60000)

  it('should verify data integrity after ingestion', () => {
    // Ingest data
    execSync(
      `npx tsx src/cli/ingest.ts "${minimalFixturePath}" --config "${testConfigPath}"`,
      { encoding: 'utf-8', cwd: join(__dirname, '../..') }
    )

    const drizzleDb = createDatabase(testDbPath)
    const db = getRawDb(drizzleDb)

    // Verify conversations have correct structure
    const conversations = db.prepare('SELECT * FROM conversations').all()
    for (const conv of conversations) {
      expect((conv as any).uuid).toBeDefined()
      expect((conv as any).name).toBeDefined()
      expect((conv as any).created_at).toBeDefined()
      expect((conv as any).platform).toBe('claude')
    }

    // Verify messages have correct structure
    const messages = db.prepare('SELECT * FROM messages').all()
    for (const msg of messages) {
      expect((msg as any).uuid).toBeDefined()
      expect((msg as any).conversation_uuid).toBeDefined()
      expect((msg as any).sender).toMatch(/^(human|assistant)$/)
      expect((msg as any).text).toBeDefined()
    }

    // Verify all messages have embeddings stored in chunks
    const chunksWithEmbeddings = db.prepare(
      'SELECT DISTINCT message_uuid FROM message_chunks WHERE embedding IS NOT NULL'
    ).all()
    expect(chunksWithEmbeddings.length).toBe(messages.length)

    // Verify foreign key relationships
    const orphanMessages = db.prepare(`
      SELECT m.uuid
      FROM messages m
      LEFT JOIN conversations c ON m.conversation_uuid = c.uuid
      WHERE c.uuid IS NULL
    `).all()
    expect(orphanMessages).toHaveLength(0)

    // Verify conversation indexes are sequential
    const messagesByConv = db.prepare(`
      SELECT conversation_uuid, conversation_index
      FROM messages
      ORDER BY conversation_uuid, conversation_index
    `).all() as Array<{ conversation_uuid: string; conversation_index: number }>

    let currentConv = ''
    let expectedIndex = 0

    for (const msg of messagesByConv) {
      if (msg.conversation_uuid !== currentConv) {
        currentConv = msg.conversation_uuid
        expectedIndex = 0
      }
      expect(msg.conversation_index).toBe(expectedIndex)
      expectedIndex++
    }

    db.close()
  }, 60000)

  it('should handle edge cases end-to-end', () => {
    const edgeCasesFixturePath = join(__dirname, '../fixtures/conversations/edge-cases.json')

    // Ingest edge cases
    const ingestOutput = execSync(
      `npx tsx src/cli/ingest.ts "${edgeCasesFixturePath}" --config "${testConfigPath}"`,
      { encoding: 'utf-8', cwd: join(__dirname, '../..') }
    )

    expect(ingestOutput).toContain('Successfully imported')

    // Verify all messages have text
    const drizzleDb = createDatabase(testDbPath)
    const db = getRawDb(drizzleDb)
    const messages = db.prepare('SELECT text FROM messages').all()

    for (const msg of messages) {
      expect((msg as any).text).toBeTruthy()
      expect((msg as any).text.length).toBeGreaterThan(0)
    }

    db.close()

    // Search should work
    const searchOutput = execSync(
      `npx tsx src/cli/search.ts "test" --config "${testConfigPath}"`,
      { encoding: 'utf-8', cwd: join(__dirname, '../..') }
    )

    expect(searchOutput).toContain('Searching for:')
  }, 60000)

  it('should persist data across database reopening', () => {
    // Ingest data
    execSync(
      `npx tsx src/cli/ingest.ts "${minimalFixturePath}" --config "${testConfigPath}"`,
      { encoding: 'utf-8', cwd: join(__dirname, '../..') }
    )

    // Get initial counts
    let drizzleDb = createDatabase(testDbPath)
    let db = getRawDb(drizzleDb)
    const initialConvCount = db.prepare('SELECT COUNT(*) as count FROM conversations').get() as { count: number }
    const initialMsgCount = db.prepare('SELECT COUNT(*) as count FROM messages').get() as { count: number }
    db.close()

    // Close and reopen database
    drizzleDb = createDatabase(testDbPath)
    db = getRawDb(drizzleDb)
    const afterConvCount = db.prepare('SELECT COUNT(*) as count FROM conversations').get() as { count: number }
    const afterMsgCount = db.prepare('SELECT COUNT(*) as count FROM messages').get() as { count: number }
    db.close()

    // Counts should match
    expect(afterConvCount.count).toBe(initialConvCount.count)
    expect(afterMsgCount.count).toBe(initialMsgCount.count)

    // Search should still work
    const searchOutput = execSync(
      `npx tsx src/cli/search.ts "test" --config "${testConfigPath}"`,
      { encoding: 'utf-8', cwd: join(__dirname, '../..') }
    )

    expect(searchOutput).toContain('Searching for:')
  }, 60000)

  it('should verify FTS5 sync after ingestion', () => {
    // Ingest data
    execSync(
      `npx tsx src/cli/ingest.ts "${minimalFixturePath}" --config "${testConfigPath}"`,
      { encoding: 'utf-8', cwd: join(__dirname, '../..') }
    )

    const drizzleDb = createDatabase(testDbPath)
    const db = getRawDb(drizzleDb)

    // Verify FTS5 tables have same row count as main tables
    const convCount = db.prepare('SELECT COUNT(*) as count FROM conversations').get() as { count: number }
    const convFtsCount = db.prepare('SELECT COUNT(*) as count FROM conversations_fts').get() as { count: number }
    expect(convFtsCount.count).toBe(convCount.count)

    const msgCount = db.prepare('SELECT COUNT(*) as count FROM messages').get() as { count: number }
    const msgFtsCount = db.prepare('SELECT COUNT(*) as count FROM messages_fts').get() as { count: number }
    expect(msgFtsCount.count).toBe(msgCount.count)

    db.close()
  }, 60000)
})
