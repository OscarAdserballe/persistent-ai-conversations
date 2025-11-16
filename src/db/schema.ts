import Database from 'better-sqlite3'

/**
 * SQL DDL for database schema
 */

export const CREATE_CONVERSATIONS_TABLE = `
CREATE TABLE IF NOT EXISTS conversations (
  uuid TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  summary TEXT,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  platform TEXT NOT NULL DEFAULT 'claude',
  message_count INTEGER DEFAULT 0,
  embedding BLOB
);
`

export const CREATE_CONVERSATIONS_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_conversations_created ON conversations(created_at);
CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at);
CREATE INDEX IF NOT EXISTS idx_conversations_platform ON conversations(platform);
`

export const CREATE_MESSAGES_TABLE = `
CREATE TABLE IF NOT EXISTS messages (
  uuid TEXT PRIMARY KEY,
  conversation_uuid TEXT NOT NULL,
  conversation_index INTEGER NOT NULL,
  sender TEXT NOT NULL CHECK(sender IN ('human', 'assistant')),
  text TEXT NOT NULL,
  created_at DATETIME NOT NULL,
  chunk_count INTEGER DEFAULT 1,

  FOREIGN KEY (conversation_uuid) REFERENCES conversations(uuid) ON DELETE CASCADE,
  UNIQUE(conversation_uuid, conversation_index)
);
`

export const CREATE_MESSAGES_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_uuid);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
`

export const CREATE_MESSAGE_CHUNKS_TABLE = `
CREATE TABLE IF NOT EXISTS message_chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_uuid TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  text TEXT NOT NULL,
  char_count INTEGER NOT NULL,
  embedding BLOB,

  FOREIGN KEY (message_uuid) REFERENCES messages(uuid) ON DELETE CASCADE,
  UNIQUE(message_uuid, chunk_index)
);
`

export const CREATE_MESSAGE_CHUNKS_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_chunks_message ON message_chunks(message_uuid);
`

// ============================================================================
// ARCHIVED TABLES (Old Schema - Preserved for Reference)
// ============================================================================

export const CREATE_ARCHIVED_LEARNINGS_TABLE = `
CREATE TABLE IF NOT EXISTS _archived_learnings (
  learning_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME,
  embedding BLOB
);
`

export const CREATE_ARCHIVED_LEARNING_CATEGORIES_TABLE = `
CREATE TABLE IF NOT EXISTS _archived_learning_categories (
  category_id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  created_at DATETIME NOT NULL
);
`

export const CREATE_ARCHIVED_LEARNING_CATEGORY_ASSIGNMENTS_TABLE = `
CREATE TABLE IF NOT EXISTS _archived_learning_category_assignments (
  learning_id TEXT NOT NULL,
  category_id TEXT NOT NULL,
  assigned_at DATETIME NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (learning_id, category_id)
);
`

export const CREATE_ARCHIVED_LEARNING_SOURCES_TABLE = `
CREATE TABLE IF NOT EXISTS _archived_learning_sources (
  learning_id TEXT NOT NULL,
  conversation_uuid TEXT,
  message_uuid TEXT
);
`

// ============================================================================
// NEW LEARNING SCHEMA (Advanced Epistemic Introspection)
// ============================================================================

export const CREATE_LEARNINGS_TABLE = `
CREATE TABLE IF NOT EXISTS learnings (
  learning_id TEXT PRIMARY KEY,

  -- Core fields
  title TEXT NOT NULL,
  context TEXT NOT NULL,
  insight TEXT NOT NULL,
  why TEXT NOT NULL,
  implications TEXT NOT NULL,
  tags TEXT NOT NULL,              -- JSON array: ["tag1", "tag2"]

  -- Nested objects stored as JSON
  abstraction TEXT NOT NULL,       -- JSON: {concrete, pattern, principle?}
  understanding TEXT NOT NULL,     -- JSON: {confidence, canTeachIt, knownGaps?}
  effort TEXT NOT NULL,            -- JSON: {processingTime, cognitiveLoad}
  resonance TEXT NOT NULL,         -- JSON: {intensity, valence}

  -- Classification
  learning_type TEXT,              -- 'principle' | 'method' | 'anti_pattern' | 'exception'
  source_credit TEXT,

  -- Source tracking (simplified - just conversation UUID)
  conversation_uuid TEXT,

  -- Vector embedding
  embedding BLOB NOT NULL,

  -- Timestamps
  created_at DATETIME NOT NULL,

  -- Constraints
  CHECK (learning_type IN ('principle', 'method', 'anti_pattern', 'exception', NULL)),
  FOREIGN KEY (conversation_uuid) REFERENCES conversations(uuid) ON DELETE SET NULL
);
`

export const CREATE_LEARNINGS_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_learnings_created ON learnings(created_at);
CREATE INDEX IF NOT EXISTS idx_learnings_type ON learnings(learning_type);
CREATE INDEX IF NOT EXISTS idx_learnings_conversation ON learnings(conversation_uuid);
`

export const CREATE_CONVERSATIONS_FTS = `
CREATE VIRTUAL TABLE IF NOT EXISTS conversations_fts USING fts5(
  uuid UNINDEXED,
  name,
  summary,
  content=conversations,
  content_rowid=rowid
);
`

export const CREATE_MESSAGES_FTS = `
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  uuid UNINDEXED,
  text,
  content=messages,
  content_rowid=rowid
);
`

export const CREATE_FTS_TRIGGERS = `
-- Triggers to keep FTS tables in sync with main tables
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
`

/**
 * Validate that the learnings table has the correct advanced schema
 *
 * This function checks if the learnings table exists and has all required columns
 * for the advanced epistemic introspection schema. If the schema is outdated or missing,
 * it throws a clear error with migration instructions.
 *
 * @param db - Database instance to validate
 * @throws Error if learnings table has wrong schema
 */
export function validateLearningsSchema(db: Database.Database): void {
  // Check if learnings table exists
  const tableExists = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type='table' AND name='learnings'
  `).get()

  if (!tableExists) {
    // Table doesn't exist - that's OK, initializeSchema will create it
    return
  }

  // Get table schema
  const schema = db.prepare('PRAGMA table_info(learnings)').all() as Array<{
    cid: number
    name: string
    type: string
    notnull: number
    dflt_value: string | null
    pk: number
  }>

  // Required columns for advanced schema
  const requiredColumns = [
    'learning_id',
    'title',
    'context',
    'insight',
    'why',
    'implications',
    'tags',
    'abstraction',
    'understanding',
    'effort',
    'resonance',
    'learning_type',
    'source_credit',
    'conversation_uuid',
    'embedding',
    'created_at'
  ]

  // Check which required columns are missing
  const actualColumns = schema.map(col => col.name)
  const missingColumns = requiredColumns.filter(col => !actualColumns.includes(col))

  if (missingColumns.length > 0) {
    throw new Error(`
❌ Database schema is outdated!

The 'learnings' table is missing required columns: ${missingColumns.join(', ')}

This usually happens when you're upgrading from an older version of the application
that used a simpler learnings schema.

To fix this, you need to run the database migration:

  1. Backup your database first:
     cp ./data/conversations.db ./data/conversations.db.backup

  2. Run the migration:
     sqlite3 ./data/conversations.db < migrations/002_advanced_learnings_schema.sql

  ⚠️  WARNING: This migration will DROP the existing learnings table and all its data!

  If you have important learnings data, you'll need to write a custom migration script
  to preserve and transform your data. See migrations/002_advanced_learnings_schema.sql
  for the new schema format.

  3. After migration, re-extract learnings:
     npm run extract-learnings

For more information, see: migrations/README.md
    `.trim())
  }

  // Schema is valid!
}

/**
 * Initialize database schema
 */
export function initializeSchema(db: Database.Database): void {
  // Enable foreign keys
  db.pragma('foreign_keys = ON')

  // Create core tables
  db.exec(CREATE_CONVERSATIONS_TABLE)
  db.exec(CREATE_CONVERSATIONS_INDEXES)
  db.exec(CREATE_MESSAGES_TABLE)
  db.exec(CREATE_MESSAGES_INDEXES)
  db.exec(CREATE_MESSAGE_CHUNKS_TABLE)
  db.exec(CREATE_MESSAGE_CHUNKS_INDEXES)

  // Create archived learning tables (old schema preserved)
  db.exec(CREATE_ARCHIVED_LEARNINGS_TABLE)
  db.exec(CREATE_ARCHIVED_LEARNING_CATEGORIES_TABLE)
  db.exec(CREATE_ARCHIVED_LEARNING_CATEGORY_ASSIGNMENTS_TABLE)
  db.exec(CREATE_ARCHIVED_LEARNING_SOURCES_TABLE)

  // Create new learning table (advanced schema)
  db.exec(CREATE_LEARNINGS_TABLE)
  db.exec(CREATE_LEARNINGS_INDEXES)

  // Create FTS tables
  db.exec(CREATE_CONVERSATIONS_FTS)
  db.exec(CREATE_MESSAGES_FTS)
  db.exec(CREATE_FTS_TRIGGERS)
}

/**
 * Prepared statements for common operations
 */
export const SQL = {
  INSERT_CONVERSATION: `
    INSERT OR IGNORE INTO conversations (
      uuid, name, summary, created_at, updated_at, platform, message_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `,

  INSERT_MESSAGE: `
    INSERT OR IGNORE INTO messages (
      uuid, conversation_uuid, conversation_index, sender, text, created_at, chunk_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `,

  INSERT_CHUNK: `
    INSERT OR IGNORE INTO message_chunks (
      message_uuid, chunk_index, text, char_count, embedding
    ) VALUES (?, ?, ?, ?, ?)
  `,

  GET_CHUNKS_BY_MESSAGE: `
    SELECT * FROM message_chunks
    WHERE message_uuid = ?
    ORDER BY chunk_index ASC
  `,

  GET_ALL_CHUNKS: `
    SELECT * FROM message_chunks
    WHERE embedding IS NOT NULL
  `,

  GET_CONVERSATION: `
    SELECT * FROM conversations WHERE uuid = ?
  `,

  GET_MESSAGE: `
    SELECT * FROM messages WHERE uuid = ?
  `,

  GET_MESSAGES_BY_CONVERSATION: `
    SELECT * FROM messages
    WHERE conversation_uuid = ?
    ORDER BY conversation_index ASC
  `,

  GET_MESSAGE_CONTEXT: `
    SELECT * FROM messages
    WHERE conversation_uuid = ?
      AND conversation_index >= ?
      AND conversation_index <= ?
    ORDER BY conversation_index ASC
  `,

  SEARCH_CONVERSATIONS_FTS: `
    SELECT uuid FROM conversations_fts WHERE conversations_fts MATCH ?
  `,

  SEARCH_MESSAGES_FTS: `
    SELECT uuid FROM messages_fts WHERE messages_fts MATCH ?
  `
}
