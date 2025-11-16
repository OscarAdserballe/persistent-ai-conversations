import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { unlinkSync, existsSync, writeFileSync } from 'fs'
import { join } from 'path'
import { execSync } from 'child_process'
import { createDefaultConfig } from '../../src/config'
import { createDatabase } from '../../src/db/database'
import { MockEmbeddingModel } from '../../src/mocks'
import { SqliteVectorStore } from '../../src/db/vector-store'
import Database from 'better-sqlite3'

describe('Search Command E2E', () => {
  const testDbPath = join(__dirname, '../tmp/e2e-search-test.db')
  const testConfigPath = join(__dirname, '../tmp/e2e-search-config.json')

  let db: Database.Database

  beforeEach(async () => {
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
      db: { path: testDbPath }
    }

    writeFileSync(testConfigPath, JSON.stringify(testConfig, null, 2))

    // Create and populate test database
    db = createDatabase(testDbPath)

    const embedder = new MockEmbeddingModel()
    const vectorStore = new SqliteVectorStore(db)
    vectorStore.initialize(embedder.dimensions)

    // Insert test data
    const convUuid = 'test-conv-1'
    const now = new Date('2024-06-01T00:00:00Z').toISOString()

    db.prepare(`
      INSERT INTO conversations (uuid, name, summary, created_at, updated_at, platform, message_count)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(convUuid, 'Test Conversation About Programming', 'Discussion about TypeScript and Python', now, now, 'claude', 4)

    const messages = [
      { uuid: 'msg-1', text: 'What is TypeScript?', sender: 'human', index: 0 },
      { uuid: 'msg-2', text: 'TypeScript is a typed superset of JavaScript that compiles to plain JavaScript.', sender: 'assistant', index: 1 },
      { uuid: 'msg-3', text: 'Tell me about Python', sender: 'human', index: 2 },
      { uuid: 'msg-4', text: 'Python is a high-level programming language known for its simplicity.', sender: 'assistant', index: 3 }
    ]

    for (const msg of messages) {
      const embedding = await embedder.embed(msg.text)

      // Insert message without embedding
      db.prepare(`
        INSERT INTO messages (uuid, conversation_uuid, conversation_index, sender, text, created_at, chunk_count)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(msg.uuid, convUuid, msg.index, msg.sender, msg.text, now, 1)

      // Insert chunk with embedding
      db.prepare(`
        INSERT INTO message_chunks (message_uuid, chunk_index, text, char_count, embedding)
        VALUES (?, ?, ?, ?, ?)
      `).run(msg.uuid, 0, msg.text, msg.text.length, Buffer.from(embedding.buffer))
    }

    db.close()
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

  it('should search and display results', () => {
    const output = execSync(
      `npx tsx src/cli/search.ts "TypeScript" --config "${testConfigPath}"`,
      { encoding: 'utf-8', cwd: join(__dirname, '../..') }
    )

    // Verify output contains expected elements
    expect(output).toContain('Searching for: "TypeScript"')
    expect(output).toContain('Found')
    expect(output).toContain('result')
    expect(output).toContain('Conversation:')
    expect(output).toContain('Test Conversation About Programming')
    expect(output).toContain('Score:')
    expect(output).toContain('TypeScript')
  }, 30000)

  it('should respect limit option', () => {
    const output = execSync(
      `npx tsx src/cli/search.ts "programming" --config "${testConfigPath}" --limit 1`,
      { encoding: 'utf-8', cwd: join(__dirname, '../..') }
    )

    expect(output).toContain('Searching for: "programming"')

    // Count how many conversation headers appear (each result has one)
    const conversationMatches = output.match(/Conversation:/g)
    expect(conversationMatches).toBeDefined()
    expect(conversationMatches!.length).toBeLessThanOrEqual(1)
  }, 30000)

  it('should filter by sender', () => {
    const output = execSync(
      `npx tsx src/cli/search.ts "TypeScript" --config "${testConfigPath}" --sender human`,
      { encoding: 'utf-8', cwd: join(__dirname, '../..') }
    )

    expect(output).toContain('Searching for: "TypeScript"')

    // The matched message should be from human (the question)
    expect(output).toContain('[HUMAN]:')
    expect(output).toContain('What is TypeScript')
  }, 30000)

  it('should filter by date range', () => {
    const output = execSync(
      `npx tsx src/cli/search.ts "TypeScript" --config "${testConfigPath}" --after 2024-01-01 --before 2024-12-31`,
      { encoding: 'utf-8', cwd: join(__dirname, '../..') }
    )

    expect(output).toContain('Searching for: "TypeScript"')
    expect(output).toContain('result')
  }, 30000)

  it('should handle no results gracefully', () => {
    // Note: This test cannot truly test "no results" with the mock embedder since it returns
    // similar embeddings for all text. Instead, we test that the search completes successfully
    // with any query, including nonsensical ones.
    const output = execSync(
      `npx tsx src/cli/search.ts "quantum computing blockchain" --config "${testConfigPath}"`,
      { encoding: 'utf-8', cwd: join(__dirname, '../..') }
    )

    expect(output).toContain('Searching for:')
    // With mock embedder, this will return results. In production with real embeddings,
    // unrelated queries would return no results.
    expect(output).toBeDefined()
  }, 30000)

  it('should display conversation context', () => {
    const output = execSync(
      `npx tsx src/cli/search.ts "TypeScript superset" --config "${testConfigPath}"`,
      { encoding: 'utf-8', cwd: join(__dirname, '../..') }
    )

    // Should show the question (previous message) before the answer
    expect(output).toContain('What is TypeScript')

    // Should highlight the matched message with >>>
    expect(output).toContain('>>>')
    expect(output).toContain('TypeScript is a typed superset')
  }, 30000)

  it('should handle missing database gracefully', () => {
    const missingDbConfig = {
      ...createDefaultConfig(),
      db: { path: join(__dirname, '../tmp/nonexistent.db') }
    }

    const missingDbConfigPath = join(__dirname, '../tmp/missing-db-config.json')
    writeFileSync(missingDbConfigPath, JSON.stringify(missingDbConfig, null, 2))

    try {
      execSync(
        `npx tsx src/cli/search.ts "test" --config "${missingDbConfigPath}"`,
        { encoding: 'utf-8', cwd: join(__dirname, '../..'), stdio: 'pipe' }
      )
      // Should not reach here - searching a non-existent database should fail
      expect(true).toBe(false)
    } catch (error: any) {
      // Should fail with non-zero exit code
      expect(error.status).not.toBe(0)
    } finally {
      if (existsSync(missingDbConfigPath)) {
        unlinkSync(missingDbConfigPath)
      }
    }
  })

  it('should handle invalid config gracefully', () => {
    const invalidConfigPath = join(__dirname, '../tmp/invalid-search-config.json')
    writeFileSync(invalidConfigPath, '{ invalid json }')

    try {
      execSync(
        `npx tsx src/cli/search.ts "test" --config "${invalidConfigPath}"`,
        { encoding: 'utf-8', cwd: join(__dirname, '../..'), stdio: 'pipe' }
      )
      // Should not reach here
      expect(true).toBe(false)
    } catch (error: any) {
      // Should fail with error
      expect(error.status).not.toBe(0)
    } finally {
      if (existsSync(invalidConfigPath)) {
        unlinkSync(invalidConfigPath)
      }
    }
  })

  it('should truncate long messages', async () => {
    // Create a message with very long text
    const longDb = createDatabase(testDbPath)
    const embedder = new MockEmbeddingModel()

    const longText = 'A'.repeat(500) // 500 character message
    const longMsgUuid = 'msg-long'

    const embedding = await embedder.embed(longText)

    // Insert message without embedding
    longDb.prepare(`
      INSERT INTO messages (uuid, conversation_uuid, conversation_index, sender, text, created_at, chunk_count)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(longMsgUuid, 'test-conv-1', 4, 'human', longText, new Date().toISOString(), 1)

    // Insert chunk with embedding
    longDb.prepare(`
      INSERT INTO message_chunks (message_uuid, chunk_index, text, char_count, embedding)
      VALUES (?, ?, ?, ?, ?)
    `).run(longMsgUuid, 0, longText, longText.length, Buffer.from(embedding.buffer))

    longDb.close()

    const output = execSync(
      `npx tsx src/cli/search.ts "AAAA" --config "${testConfigPath}"`,
      { encoding: 'utf-8', cwd: join(__dirname, '../..') }
    )

    // Should contain truncation indicator for context messages
    expect(output).toContain('...')
  }, 30000)

  it('should display score as percentage', () => {
    const output = execSync(
      `npx tsx src/cli/search.ts "TypeScript" --config "${testConfigPath}"`,
      { encoding: 'utf-8', cwd: join(__dirname, '../..') }
    )

    // Should show score with percentage
    expect(output).toMatch(/Score:\s+\d+\.\d+%/)
  }, 30000)

  it('should handle special characters in query', () => {
    const output = execSync(
      `npx tsx src/cli/search.ts "TypeScript & JavaScript" --config "${testConfigPath}"`,
      { encoding: 'utf-8', cwd: join(__dirname, '../..') }
    )

    expect(output).toContain('Searching for:')
    // Should not crash
    expect(output).toBeDefined()
  }, 30000)

  it('should format dates correctly', () => {
    const output = execSync(
      `npx tsx src/cli/search.ts "TypeScript" --config "${testConfigPath}"`,
      { encoding: 'utf-8', cwd: join(__dirname, '../..') }
    )

    // Should show date in YYYY-MM-DD format
    expect(output).toMatch(/Date:\s+\d{4}-\d{2}-\d{2}/)
  }, 30000)

  it('should separate results with visual dividers', () => {
    const output = execSync(
      `npx tsx src/cli/search.ts "programming" --config "${testConfigPath}"`,
      { encoding: 'utf-8', cwd: join(__dirname, '../..') }
    )

    // Should have separator lines (80 equal signs)
    expect(output).toContain('='.repeat(80))
  }, 30000)
})
