import { sqliteTable, text, integer, blob, index, unique } from 'drizzle-orm/sqlite-core'
import { relations } from 'drizzle-orm'

// ============================================================================
// CORE TABLES
// ============================================================================

export const conversations = sqliteTable('conversations', {
  uuid: text('uuid').primaryKey(),
  name: text('name').notNull(),
  summary: text('summary'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  platform: text('platform').notNull().default('claude'),
  messageCount: integer('message_count').notNull().default(0),
  embedding: blob('embedding', { mode: 'buffer' })
}, (table) => ({
  createdIdx: index('idx_conversations_created').on(table.createdAt),
  updatedIdx: index('idx_conversations_updated').on(table.updatedAt),
  platformIdx: index('idx_conversations_platform').on(table.platform)
}))

export const messages = sqliteTable('messages', {
  uuid: text('uuid').primaryKey(),
  conversationUuid: text('conversation_uuid')
    .notNull()
    .references(() => conversations.uuid, { onDelete: 'cascade' }),
  conversationIndex: integer('conversation_index').notNull(),
  sender: text('sender', { enum: ['human', 'assistant'] }).notNull(),
  text: text('text').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  chunkCount: integer('chunk_count').notNull().default(1)
}, (table) => ({
  conversationIdx: index('idx_messages_conversation').on(table.conversationUuid),
  senderIdx: index('idx_messages_sender').on(table.sender),
  createdIdx: index('idx_messages_created').on(table.createdAt),
  conversationIndexUnique: unique('messages_conversation_index').on(table.conversationUuid, table.conversationIndex)
}))

export const messageChunks = sqliteTable('message_chunks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  messageUuid: text('message_uuid')
    .notNull()
    .references(() => messages.uuid, { onDelete: 'cascade' }),
  chunkIndex: integer('chunk_index').notNull(),
  text: text('text').notNull(),
  charCount: integer('char_count').notNull(),
  embedding: blob('embedding', { mode: 'buffer' })
}, (table) => ({
  messageIdx: index('idx_chunks_message').on(table.messageUuid),
  chunkIndexUnique: unique('message_chunks_unique').on(table.messageUuid, table.chunkIndex)
}))

// ============================================================================
// ARCHIVED TABLES (Old Schema - Preserved for Reference)
// ============================================================================

export const archivedLearnings = sqliteTable('_archived_learnings', {
  learningId: text('learning_id').primaryKey(),
  title: text('title').notNull(),
  content: text('content').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }),
  embedding: blob('embedding', { mode: 'buffer' })
})

export const archivedLearningCategories = sqliteTable('_archived_learning_categories', {
  categoryId: text('category_id').primaryKey(),
  name: text('name').notNull().unique(),
  description: text('description'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
})

export const archivedLearningCategoryAssignments = sqliteTable('_archived_learning_category_assignments', {
  learningId: text('learning_id').notNull(),
  categoryId: text('category_id').notNull(),
  assignedAt: integer('assigned_at', { mode: 'timestamp_ms' }).notNull().$default(() => new Date())
}, (table) => ({
  pk: unique('archived_category_pk').on(table.learningId, table.categoryId)
}))

export const archivedLearningSources = sqliteTable('_archived_learning_sources', {
  learningId: text('learning_id').notNull(),
  conversationUuid: text('conversation_uuid'),
  messageUuid: text('message_uuid')
})

// ============================================================================
// LEARNINGS TABLE (Advanced Epistemic Introspection Schema)
// ============================================================================

// Type definitions for JSON columns
export type Abstraction = {
  concrete: string
  pattern: string
  principle?: string
}

export type Understanding = {
  confidence: number
  can_teach_it: boolean
  known_gaps?: string[]
}

export type Effort = {
  processing_time: '5min' | '30min' | '2hr' | 'days'
  cognitive_load: 'easy' | 'moderate' | 'hard' | 'breakthrough'
}

export type Resonance = {
  intensity: number
  valence: 'positive' | 'negative' | 'mixed'
}

export type LearningType = 'principle' | 'method' | 'anti_pattern' | 'exception'

export const learnings = sqliteTable('learnings', {
  learningId: text('learning_id').primaryKey(),

  // Core fields
  title: text('title').notNull(),
  context: text('context').notNull(),
  insight: text('insight').notNull(),
  why: text('why').notNull(),
  implications: text('implications').notNull(),

  // JSON columns with type inference
  tags: text('tags', { mode: 'json' }).$type<string[]>().notNull(),
  abstraction: text('abstraction', { mode: 'json' }).$type<Abstraction>().notNull(),
  understanding: text('understanding', { mode: 'json' }).$type<Understanding>().notNull(),
  effort: text('effort', { mode: 'json' }).$type<Effort>().notNull(),
  resonance: text('resonance', { mode: 'json' }).$type<Resonance>().notNull(),

  // Classification
  learningType: text('learning_type', {
    enum: ['principle', 'method', 'anti_pattern', 'exception']
  }).$type<LearningType>(),
  sourceCredit: text('source_credit'),

  // Source tracking
  conversationUuid: text('conversation_uuid')
    .references(() => conversations.uuid, { onDelete: 'set null' }),

  // Vector embedding
  embedding: blob('embedding', { mode: 'buffer' }).notNull(),

  // Timestamps
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
}, (table) => ({
  createdIdx: index('idx_learnings_created').on(table.createdAt),
  typeIdx: index('idx_learnings_type').on(table.learningType),
  conversationIdx: index('idx_learnings_conversation').on(table.conversationUuid)
}))

// ============================================================================
// RELATIONS (for relational queries)
// ============================================================================

export const conversationsRelations = relations(conversations, ({ many }) => ({
  messages: many(messages),
  learnings: many(learnings)
}))

export const messagesRelations = relations(messages, ({ one, many }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationUuid],
    references: [conversations.uuid]
  }),
  chunks: many(messageChunks)
}))

export const messageChunksRelations = relations(messageChunks, ({ one }) => ({
  message: one(messages, {
    fields: [messageChunks.messageUuid],
    references: [messages.uuid]
  })
}))

export const learningsRelations = relations(learnings, ({ one }) => ({
  conversation: one(conversations, {
    fields: [learnings.conversationUuid],
    references: [conversations.uuid]
  })
}))

// ============================================================================
// TYPE INFERENCE (automatically generated from schema)
// ============================================================================

// Select types (reading from DB)
export type Conversation = typeof conversations.$inferSelect
export type Message = typeof messages.$inferSelect
export type MessageChunk = typeof messageChunks.$inferSelect
export type Learning = typeof learnings.$inferSelect

// Insert types (writing to DB)
export type ConversationInsert = typeof conversations.$inferInsert
export type MessageInsert = typeof messages.$inferInsert
export type MessageChunkInsert = typeof messageChunks.$inferInsert
export type LearningInsert = typeof learnings.$inferInsert

// ============================================================================
// LEGACY COMPATIBILITY (for tests during migration)
// ============================================================================

import Database from 'better-sqlite3'

/**
 * @deprecated Use Drizzle migrations instead. This is kept for backward compatibility during migration.
 * Legacy function to initialize schema using raw SQL.
 * Creates tables directly using SQL for tests that don't use the factory.
 */
export function initializeSchema(db: Database.Database): void {
  // Enable foreign keys
  db.pragma('foreign_keys = ON')

  // Create tables using Drizzle-generated SQL
  // This ensures compatibility during migration phase
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      uuid TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      summary TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      platform TEXT DEFAULT 'claude' NOT NULL,
      message_count INTEGER DEFAULT 0 NOT NULL,
      embedding BLOB
    );

    CREATE INDEX IF NOT EXISTS idx_conversations_created ON conversations (created_at);
    CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations (updated_at);
    CREATE INDEX IF NOT EXISTS idx_conversations_platform ON conversations (platform);

    CREATE TABLE IF NOT EXISTS messages (
      uuid TEXT PRIMARY KEY NOT NULL,
      conversation_uuid TEXT NOT NULL,
      conversation_index INTEGER NOT NULL,
      sender TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      chunk_count INTEGER DEFAULT 1 NOT NULL,
      FOREIGN KEY (conversation_uuid) REFERENCES conversations(uuid) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages (conversation_uuid);
    CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages (sender);
    CREATE INDEX IF NOT EXISTS idx_messages_created ON messages (created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS messages_conversation_index ON messages (conversation_uuid, conversation_index);

    CREATE TABLE IF NOT EXISTS message_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      message_uuid TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      text TEXT NOT NULL,
      char_count INTEGER NOT NULL,
      embedding BLOB,
      FOREIGN KEY (message_uuid) REFERENCES messages(uuid) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_chunks_message ON message_chunks (message_uuid);
    CREATE UNIQUE INDEX IF NOT EXISTS message_chunks_unique ON message_chunks (message_uuid, chunk_index);

    CREATE TABLE IF NOT EXISTS learnings (
      learning_id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      context TEXT NOT NULL,
      insight TEXT NOT NULL,
      why TEXT NOT NULL,
      implications TEXT NOT NULL,
      tags TEXT NOT NULL,
      abstraction TEXT NOT NULL,
      understanding TEXT NOT NULL,
      effort TEXT NOT NULL,
      resonance TEXT NOT NULL,
      learning_type TEXT,
      source_credit TEXT,
      conversation_uuid TEXT,
      embedding BLOB NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (conversation_uuid) REFERENCES conversations(uuid) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_learnings_created ON learnings (created_at);
    CREATE INDEX IF NOT EXISTS idx_learnings_type ON learnings (learning_type);
    CREATE INDEX IF NOT EXISTS idx_learnings_conversation ON learnings (conversation_uuid);

    CREATE TABLE IF NOT EXISTS _archived_learnings (
      learning_id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER,
      embedding BLOB
    );

    CREATE TABLE IF NOT EXISTS _archived_learning_categories (
      category_id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS _archived_learning_categories_name_unique ON _archived_learning_categories (name);

    CREATE TABLE IF NOT EXISTS _archived_learning_category_assignments (
      learning_id TEXT NOT NULL,
      category_id TEXT NOT NULL,
      assigned_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS archived_category_pk ON _archived_learning_category_assignments (learning_id, category_id);

    CREATE TABLE IF NOT EXISTS _archived_learning_sources (
      learning_id TEXT NOT NULL,
      conversation_uuid TEXT,
      message_uuid TEXT
    );

    -- FTS5 tables
    CREATE VIRTUAL TABLE IF NOT EXISTS conversations_fts USING fts5(
      uuid UNINDEXED,
      name,
      summary,
      content=conversations,
      content_rowid=rowid
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      uuid UNINDEXED,
      text,
      content=messages,
      content_rowid=rowid
    );

    -- FTS triggers
    CREATE TRIGGER IF NOT EXISTS conversations_fts_insert AFTER INSERT ON conversations BEGIN
      INSERT INTO conversations_fts(uuid, name, summary) VALUES (new.uuid, new.name, new.summary);
    END;

    CREATE TRIGGER IF NOT EXISTS conversations_fts_delete AFTER DELETE ON conversations BEGIN
      DELETE FROM conversations_fts WHERE uuid = old.uuid;
    END;

    CREATE TRIGGER IF NOT EXISTS conversations_fts_update AFTER UPDATE ON conversations BEGIN
      DELETE FROM conversations_fts WHERE uuid = old.uuid;
      INSERT INTO conversations_fts(uuid, name, summary) VALUES (new.uuid, new.name, new.summary);
    END;

    CREATE TRIGGER IF NOT EXISTS messages_fts_insert AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts(uuid, text) VALUES (new.uuid, new.text);
    END;

    CREATE TRIGGER IF NOT EXISTS messages_fts_delete AFTER DELETE ON messages BEGIN
      DELETE FROM messages_fts WHERE uuid = old.uuid;
    END;

    CREATE TRIGGER IF NOT EXISTS messages_fts_update AFTER UPDATE ON messages BEGIN
      DELETE FROM messages_fts WHERE uuid = old.uuid;
      INSERT INTO messages_fts(uuid, text) VALUES (new.uuid, new.text);
    END;
  `)
}

/**
 * @deprecated No longer needed with Drizzle migrations. Kept for backward compatibility.
 */
export function validateLearningsSchema(_db: Database.Database): void {
  // Schema validation is now handled by Drizzle
  // This function is deprecated but kept for tests during migration
}
