import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { unlinkSync, existsSync } from 'fs'
import { join } from 'path'
import { createDatabase, closeDatabase } from '../../src/db/database'
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
    const db = createDatabase(testDbPath)

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

    closeDatabase(db)
  })

  it('should have correct indexes', () => {
    const db = createDatabase(testDbPath)

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

    closeDatabase(db)
  })

  it('should enforce foreign key constraints', () => {
    const db = createDatabase(testDbPath)

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

    closeDatabase(db)
  })

  it('should support insert and query operations', () => {
    const db = createDatabase(testDbPath)

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

    closeDatabase(db)
  })

  it('should cascade delete messages when conversation is deleted', () => {
    const db = createDatabase(testDbPath)

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

    closeDatabase(db)
  })

  it('should sync FTS5 tables automatically', () => {
    const db = createDatabase(testDbPath)

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

    closeDatabase(db)
  })

  it('should support reopening database', () => {
    // Create and close database
    let db = createDatabase(testDbPath)
    const convUuid = 'test-conv-4'
    const now = new Date().toISOString()

    db.prepare(`
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(convUuid, 'Persistent Test', now, now, 'claude', 0)

    closeDatabase(db)

    // Reopen database
    db = new Database(testDbPath)

    // Verify data persists
    const conversation = db.prepare(`
      SELECT * FROM conversations WHERE uuid = ?
    `).get(convUuid)
    expect(conversation).toBeDefined()
    expect((conversation as any).name).toBe('Persistent Test')

    closeDatabase(db)
  })
})
