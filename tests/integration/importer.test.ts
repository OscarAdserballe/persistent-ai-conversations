import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { unlinkSync, existsSync } from 'fs'
import { join } from 'path'
import { createDatabase, closeDatabase } from '../../src/db/database'
import { ClaudeImporter } from '../../src/importers/claude'
import Database from 'better-sqlite3'

describe('Importer Integration', () => {
  const testDbPath = join(__dirname, '../tmp/importer-integration-test.db')
  const minimalFixturePath = join(__dirname, '../fixtures/conversations/minimal.json')
  const edgeCasesFixturePath = join(__dirname, '../fixtures/conversations/edge-cases.json')

  let db: Database.Database

  beforeEach(() => {
    // Clean up any existing test database
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath)
    }
    db = createDatabase(testDbPath)
  })

  afterEach(() => {
    closeDatabase(db)
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath)
    }
  })

  it('should import minimal conversation into database', async () => {
    const importer = new ClaudeImporter()

    let conversationCount = 0
    let messageCount = 0

    // Import conversations
    for await (const conversation of importer.import(minimalFixturePath)) {
      // Insert conversation
      db.prepare(`
        INSERT INTO conversations (uuid, name, summary, created_at, updated_at, platform, message_count)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        conversation.uuid,
        conversation.title,
        conversation.summary || null,
        conversation.createdAt.toISOString(),
        conversation.updatedAt.toISOString(),
        conversation.platform,
        conversation.messages.length
      )

      // Insert messages
      for (const message of conversation.messages) {
        db.prepare(`
          INSERT INTO messages (uuid, conversation_uuid, conversation_index, sender, text, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          message.uuid,
          message.conversationUuid,
          message.conversationIndex,
          message.sender,
          message.text,
          message.createdAt.toISOString()
        )
        messageCount++
      }

      conversationCount++
    }

    // Verify counts (minimal.json has 2 conversations with 5 messages each)
    expect(conversationCount).toBe(2)
    expect(messageCount).toBe(10)

    // Verify conversation in database
    const conversations = db.prepare('SELECT * FROM conversations').all()
    expect(conversations).toHaveLength(2)
    expect((conversations[0] as any).platform).toBe('claude')

    // Verify messages in database
    const messages = db.prepare('SELECT * FROM messages ORDER BY conversation_uuid, conversation_index').all()
    expect(messages).toHaveLength(10)
    expect((messages[0] as any).sender).toBe('human')
    expect((messages[1] as any).sender).toBe('assistant')
  })

  it('should handle edge cases during import', async () => {
    const importer = new ClaudeImporter()

    let conversationCount = 0
    let messageCount = 0

    // Import edge cases
    for await (const conversation of importer.import(edgeCasesFixturePath)) {
      // Insert conversation
      db.prepare(`
        INSERT INTO conversations (uuid, name, summary, created_at, updated_at, platform, message_count)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        conversation.uuid,
        conversation.title,
        conversation.summary || null,
        conversation.createdAt.toISOString(),
        conversation.updatedAt.toISOString(),
        conversation.platform,
        conversation.messages.length
      )

      // Insert messages
      for (const message of conversation.messages) {
        db.prepare(`
          INSERT INTO messages (uuid, conversation_uuid, conversation_index, sender, text, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          message.uuid,
          message.conversationUuid,
          message.conversationIndex,
          message.sender,
          message.text,
          message.createdAt.toISOString()
        )
        messageCount++
      }

      conversationCount++
    }

    // Verify we imported the conversation
    expect(conversationCount).toBe(1)
    expect(messageCount).toBeGreaterThan(0)

    // Verify all messages have text (even if placeholder)
    const messages = db.prepare('SELECT * FROM messages').all()
    for (const message of messages) {
      expect((message as any).text).toBeTruthy()
      expect((message as any).text.length).toBeGreaterThan(0)
    }
  })

  it('should maintain conversation index ordering', async () => {
    const importer = new ClaudeImporter()

    let firstConvUuid = ''

    for await (const conversation of importer.import(minimalFixturePath)) {
      if (!firstConvUuid) {
        firstConvUuid = conversation.uuid
      }

      // Insert conversation
      db.prepare(`
        INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        conversation.uuid,
        conversation.title,
        conversation.createdAt.toISOString(),
        conversation.updatedAt.toISOString(),
        conversation.platform,
        conversation.messages.length
      )

      // Insert messages
      for (const message of conversation.messages) {
        db.prepare(`
          INSERT INTO messages (uuid, conversation_uuid, conversation_index, sender, text, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          message.uuid,
          message.conversationUuid,
          message.conversationIndex,
          message.sender,
          message.text,
          message.createdAt.toISOString()
        )
      }
    }

    // Query messages from first conversation in order
    const messages = db.prepare(`
      SELECT conversation_index FROM messages
      WHERE conversation_uuid = ?
      ORDER BY conversation_index
    `).all(firstConvUuid) as Array<{ conversation_index: number }>

    // Verify sequential ordering starting from 0
    expect(messages[0].conversation_index).toBe(0)
    expect(messages[1].conversation_index).toBe(1)
    expect(messages[2].conversation_index).toBe(2)
  })

  it('should enforce unique conversation_uuid + conversation_index constraint', async () => {
    const importer = new ClaudeImporter()

    for await (const conversation of importer.import(minimalFixturePath)) {
      // Insert conversation
      db.prepare(`
        INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        conversation.uuid,
        conversation.title,
        conversation.createdAt.toISOString(),
        conversation.updatedAt.toISOString(),
        conversation.platform,
        conversation.messages.length
      )

      // Insert first message
      const firstMessage = conversation.messages[0]
      db.prepare(`
        INSERT INTO messages (uuid, conversation_uuid, conversation_index, sender, text, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        firstMessage.uuid,
        firstMessage.conversationUuid,
        firstMessage.conversationIndex,
        firstMessage.sender,
        firstMessage.text,
        firstMessage.createdAt.toISOString()
      )

      // Try to insert another message with the same conversation_uuid and index (should fail)
      expect(() => {
        db.prepare(`
          INSERT INTO messages (uuid, conversation_uuid, conversation_index, sender, text, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          'different-uuid',
          firstMessage.conversationUuid,
          firstMessage.conversationIndex, // Same index - should fail
          'human',
          'Duplicate',
          new Date().toISOString()
        )
      }).toThrow()
    }
  })

  it('should handle sender normalization', async () => {
    const importer = new ClaudeImporter()

    for await (const conversation of importer.import(minimalFixturePath)) {
      // Insert conversation
      db.prepare(`
        INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        conversation.uuid,
        conversation.title,
        conversation.createdAt.toISOString(),
        conversation.updatedAt.toISOString(),
        conversation.platform,
        conversation.messages.length
      )

      // Insert messages
      for (const message of conversation.messages) {
        db.prepare(`
          INSERT INTO messages (uuid, conversation_uuid, conversation_index, sender, text, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          message.uuid,
          message.conversationUuid,
          message.conversationIndex,
          message.sender,
          message.text,
          message.createdAt.toISOString()
        )
      }
    }

    // Verify all senders are either 'human' or 'assistant'
    const messages = db.prepare('SELECT DISTINCT sender FROM messages').all() as Array<{ sender: string }>
    const senders = messages.map(m => m.sender)

    for (const sender of senders) {
      expect(['human', 'assistant']).toContain(sender)
    }
  })

  it('should populate FTS5 tables during import', async () => {
    const importer = new ClaudeImporter()

    for await (const conversation of importer.import(minimalFixturePath)) {
      // Insert conversation
      db.prepare(`
        INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        conversation.uuid,
        conversation.title,
        conversation.createdAt.toISOString(),
        conversation.updatedAt.toISOString(),
        conversation.platform,
        conversation.messages.length
      )

      // Insert messages
      for (const message of conversation.messages) {
        db.prepare(`
          INSERT INTO messages (uuid, conversation_uuid, conversation_index, sender, text, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          message.uuid,
          message.conversationUuid,
          message.conversationIndex,
          message.sender,
          message.text,
          message.createdAt.toISOString()
        )
      }
    }

    // Search for content in FTS5 (search for "TypeScript" which is in the minimal.json)
    const results = db.prepare(`
      SELECT uuid FROM messages_fts WHERE text MATCH ?
    `).all('TypeScript') as Array<{ uuid: string }>

    expect(results.length).toBeGreaterThan(0)
  })

  it('should handle multiple conversations in sequence', async () => {
    const importer = new ClaudeImporter()

    // Create a fixture with multiple conversations
    const multiConvPath = join(__dirname, '../tmp/multi-conv-test.json')
    const fs = require('fs')

    const multipleConversations = [
      {
        uuid: 'conv-1',
        name: 'First Conversation',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        chat_messages: [
          {
            uuid: 'msg-1',
            sender: 'human',
            text: 'First message',
            created_at: '2024-01-01T00:00:00Z',
            content: [{ type: 'text', text: 'First message' }]
          }
        ]
      },
      {
        uuid: 'conv-2',
        name: 'Second Conversation',
        created_at: '2024-01-02T00:00:00Z',
        updated_at: '2024-01-02T00:00:00Z',
        chat_messages: [
          {
            uuid: 'msg-2',
            sender: 'human',
            text: 'Second message',
            created_at: '2024-01-02T00:00:00Z',
            content: [{ type: 'text', text: 'Second message' }]
          }
        ]
      }
    ]

    fs.writeFileSync(multiConvPath, JSON.stringify(multipleConversations))

    try {
      let conversationCount = 0

      for await (const conversation of importer.import(multiConvPath)) {
        // Insert conversation
        db.prepare(`
          INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          conversation.uuid,
          conversation.title,
          conversation.createdAt.toISOString(),
          conversation.updatedAt.toISOString(),
          conversation.platform,
          conversation.messages.length
        )

        // Insert messages
        for (const message of conversation.messages) {
          db.prepare(`
            INSERT INTO messages (uuid, conversation_uuid, conversation_index, sender, text, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(
            message.uuid,
            message.conversationUuid,
            message.conversationIndex,
            message.sender,
            message.text,
            message.createdAt.toISOString()
          )
        }

        conversationCount++
      }

      expect(conversationCount).toBe(2)

      // Verify both conversations in database
      const conversations = db.prepare('SELECT * FROM conversations ORDER BY created_at').all()
      expect(conversations).toHaveLength(2)
      expect((conversations[0] as any).name).toBe('First Conversation')
      expect((conversations[1] as any).name).toBe('Second Conversation')

      // Verify messages belong to correct conversations
      const conv1Messages = db.prepare('SELECT * FROM messages WHERE conversation_uuid = ?').all('conv-1')
      expect(conv1Messages).toHaveLength(1)

      const conv2Messages = db.prepare('SELECT * FROM messages WHERE conversation_uuid = ?').all('conv-2')
      expect(conv2Messages).toHaveLength(1)

    } finally {
      // Clean up
      if (fs.existsSync(multiConvPath)) {
        fs.unlinkSync(multiConvPath)
      }
    }
  })
})
