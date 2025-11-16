import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { unlinkSync, existsSync } from 'fs'
import { join } from 'path'
import { createDatabase } from '../../src/factories'
import { getRawDb } from '../../src/db/client'
import Database from 'better-sqlite3'

describe('Database Integration', () => {
  const testDbPath = join(__dirname, '../tmp/integration-test.db')

  beforeEach(() => {
    // Clean up any existing test database
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath)
    }
  })

  afterEach(() => {
    // Clean up test database
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath)
    }
  })

  it('should create database with correct schema', () => {
    const drizzleDb = createDatabase(testDbPath)
    const db = getRawDb(drizzleDb)

    // Verify database file was created
    expect(existsSync(testDbPath)).toBe(true)

    // Verify WAL mode is enabled
    const walMode = db.pragma('journal_mode', { simple: true })
    expect(walMode).toBe('wal')

    // Verify conversations table exists
    const conversationsTable = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name='conversations'
    `).get()
    expect(conversationsTable).toBeDefined()

    // Verify messages table exists
    const messagesTable = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name='messages'
    `).get()
    expect(messagesTable).toBeDefined()

    // Verify FTS5 tables exist
    const conversationsFts = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name='conversations_fts'
    `).get()
    expect(conversationsFts).toBeDefined()

    const messagesFts = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name='messages_fts'
    `).get()
    expect(messagesFts).toBeDefined()

    // Verify learnings tables exist (future-ready)
    const learningsTable = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name='learnings'
    `).get()
    expect(learningsTable).toBeDefined()

    db.close()
  })

  it('should have correct indexes', () => {
    const drizzleDb = createDatabase(testDbPath)
    const db = getRawDb(drizzleDb)

    // Get all indexes
    const indexes = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='index'
    `).all() as Array<{ name: string }>

    const indexNames = indexes.map(idx => idx.name)

    // Verify expected indexes exist
    expect(indexNames).toContain('idx_conversations_created')
    expect(indexNames).toContain('idx_conversations_updated')
    expect(indexNames).toContain('idx_conversations_platform')
    expect(indexNames).toContain('idx_messages_conversation')
    expect(indexNames).toContain('idx_messages_sender')
    expect(indexNames).toContain('idx_messages_created')

    db.close()
  })

  it('should enforce foreign key constraints', () => {
    const drizzleDb = createDatabase(testDbPath)
    const db = getRawDb(drizzleDb)

    // Verify foreign keys are enabled
    const fkEnabled = db.pragma('foreign_keys', { simple: true })
    expect(fkEnabled).toBe(1)

    // Try to insert a message without a conversation (should fail)
    expect(() => {
      db.prepare(`
        INSERT INTO messages (uuid, conversation_uuid, conversation_index, sender, text, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('msg-1', 'nonexistent-conv', 0, 'human', 'test', new Date().toISOString())
    }).toThrow()

    db.close()
  })

  it('should support insert and query operations', () => {
    const drizzleDb = createDatabase(testDbPath)
    const db = getRawDb(drizzleDb)

    const convUuid = 'test-conv-1'
    const msgUuid = 'test-msg-1'
    const now = new Date().toISOString()

    // Insert a conversation
    db.prepare(`
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(convUuid, 'Test Conversation', now, now, 'claude', 1)

    // Verify conversation was inserted
    const conversation = db.prepare(`
      SELECT * FROM conversations WHERE uuid = ?
    `).get(convUuid)
    expect(conversation).toBeDefined()
    expect((conversation as any).name).toBe('Test Conversation')

    // Insert a message
    db.prepare(`
      INSERT INTO messages (uuid, conversation_uuid, conversation_index, sender, text, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(msgUuid, convUuid, 0, 'human', 'Hello, world!', now)

    // Verify message was inserted
    const message = db.prepare(`
      SELECT * FROM messages WHERE uuid = ?
    `).get(msgUuid)
    expect(message).toBeDefined()
    expect((message as any).text).toBe('Hello, world!')

    db.close()
  })

  it('should cascade delete messages when conversation is deleted', () => {
    const drizzleDb = createDatabase(testDbPath)
    const db = getRawDb(drizzleDb)

    const convUuid = 'test-conv-2'
    const msgUuid = 'test-msg-2'
    const now = new Date().toISOString()

    // Insert conversation and message
    db.prepare(`
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(convUuid, 'Test', now, now, 'claude', 1)

    db.prepare(`
      INSERT INTO messages (uuid, conversation_uuid, conversation_index, sender, text, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(msgUuid, convUuid, 0, 'human', 'Test', now)

    // Delete conversation
    db.prepare('DELETE FROM conversations WHERE uuid = ?').run(convUuid)

    // Verify message was also deleted (cascade)
    const message = db.prepare('SELECT * FROM messages WHERE uuid = ?').get(msgUuid)
    expect(message).toBeUndefined()

    db.close()
  })

  it('should sync FTS5 tables automatically', () => {
    const drizzleDb = createDatabase(testDbPath)
    const db = getRawDb(drizzleDb)

    const convUuid = 'test-conv-3'
    const now = new Date().toISOString()

    // Insert a conversation
    db.prepare(`
      INSERT INTO conversations (uuid, name, summary, created_at, updated_at, platform, message_count)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(convUuid, 'Test Search', 'A test summary about TypeScript', now, now, 'claude', 0)

    // Search in FTS5 table
    const results = db.prepare(`
      SELECT uuid FROM conversations_fts WHERE conversations_fts MATCH ?
    `).all('TypeScript') as Array<{ uuid: string }>

    expect(results.length).toBe(1)
    expect(results[0].uuid).toBe(convUuid)

    db.close()
  })

  it('should support reopening database', () => {
    // Create and close database
    let drizzleDb = createDatabase(testDbPath)
    let db = getRawDb(drizzleDb)
    const convUuid = 'test-conv-4'
    const now = new Date().toISOString()

    db.prepare(`
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(convUuid, 'Persistent Test', now, now, 'claude', 0)

    db.close()

    // Reopen database
    db = new Database(testDbPath)

    // Verify data persists
    const conversation = db.prepare(`
      SELECT * FROM conversations WHERE uuid = ?
    `).get(convUuid)
    expect(conversation).toBeDefined()
    expect((conversation as any).name).toBe('Persistent Test')

    db.close()
  })
})
