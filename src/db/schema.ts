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

export const CREATE_LEARNINGS_TABLE = `
CREATE TABLE IF NOT EXISTS learnings (
  learning_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME,
  embedding BLOB
);
`

export const CREATE_LEARNINGS_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_learnings_created ON learnings(created_at);
`

export const CREATE_LEARNING_CATEGORIES_TABLE = `
CREATE TABLE IF NOT EXISTS learning_categories (
  category_id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  created_at DATETIME NOT NULL
);
`

export const CREATE_LEARNING_CATEGORIES_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_learning_categories_name ON learning_categories(name);
`

export const CREATE_LEARNING_CATEGORY_ASSIGNMENTS_TABLE = `
CREATE TABLE IF NOT EXISTS learning_category_assignments (
  learning_id TEXT NOT NULL,
  category_id TEXT NOT NULL,
  assigned_at DATETIME NOT NULL DEFAULT (datetime('now')),

  PRIMARY KEY (learning_id, category_id),
  FOREIGN KEY (learning_id) REFERENCES learnings(learning_id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES learning_categories(category_id) ON DELETE CASCADE
);
`

export const CREATE_LEARNING_CATEGORY_ASSIGNMENTS_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_lca_learning ON learning_category_assignments(learning_id);
CREATE INDEX IF NOT EXISTS idx_lca_category ON learning_category_assignments(category_id);
`

export const CREATE_LEARNING_SOURCES_TABLE = `
CREATE TABLE IF NOT EXISTS learning_sources (
  learning_id TEXT NOT NULL,
  conversation_uuid TEXT,
  message_uuid TEXT,

  FOREIGN KEY (learning_id) REFERENCES learnings(learning_id) ON DELETE CASCADE,
  FOREIGN KEY (conversation_uuid) REFERENCES conversations(uuid) ON DELETE CASCADE,
  FOREIGN KEY (message_uuid) REFERENCES messages(uuid) ON DELETE CASCADE
);
`

export const CREATE_LEARNING_SOURCES_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_learning_sources_learning ON learning_sources(learning_id);
CREATE INDEX IF NOT EXISTS idx_learning_sources_conv ON learning_sources(conversation_uuid);
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
 * Initialize database schema
 */
export function initializeSchema(db: Database.Database): void {
  // Enable foreign keys
  db.pragma('foreign_keys = ON')

  // Create tables
  db.exec(CREATE_CONVERSATIONS_TABLE)
  db.exec(CREATE_CONVERSATIONS_INDEXES)
  db.exec(CREATE_MESSAGES_TABLE)
  db.exec(CREATE_MESSAGES_INDEXES)
  db.exec(CREATE_MESSAGE_CHUNKS_TABLE)
  db.exec(CREATE_MESSAGE_CHUNKS_INDEXES)

  // Learning tables
  db.exec(CREATE_LEARNINGS_TABLE)
  db.exec(CREATE_LEARNINGS_INDEXES)
  db.exec(CREATE_LEARNING_CATEGORIES_TABLE)
  db.exec(CREATE_LEARNING_CATEGORIES_INDEXES)
  db.exec(CREATE_LEARNING_CATEGORY_ASSIGNMENTS_TABLE)
  db.exec(CREATE_LEARNING_CATEGORY_ASSIGNMENTS_INDEXES)
  db.exec(CREATE_LEARNING_SOURCES_TABLE)
  db.exec(CREATE_LEARNING_SOURCES_INDEXES)

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
