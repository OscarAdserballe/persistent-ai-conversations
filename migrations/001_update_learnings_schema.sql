-- ⚠️  DEPRECATED - DO NOT USE THIS MIGRATION ⚠️
--
-- This migration is OUTDATED and creates an obsolete schema.
-- Use migration 002_advanced_learnings_schema.sql instead.
--
-- Historical Information:
-- Migration: Update learnings schema to use UUID and add category support
-- Date: 2025-11-11
-- Description:
--   - Changes learnings primary key from INTEGER to TEXT (UUID)
--   - Removes old confidence_score and updated_at columns
--   - Adds proper foreign key relationships for categories and sources
--   - Enables many-to-many category assignments
--
-- WARNING: This drops existing learnings data!
--
-- ⚠️  This schema was replaced by the advanced learnings schema in November 2025.
-- ⚠️  See: migrations/002_advanced_learnings_schema.sql

-- Drop old learnings tables
DROP TABLE IF EXISTS learning_category_assignments;
DROP TABLE IF EXISTS learning_sources;
DROP TABLE IF EXISTS learning_categories;
DROP TABLE IF EXISTS learnings;

-- Create new learnings table with UUID primary key
CREATE TABLE IF NOT EXISTS learnings (
  learning_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at DATETIME NOT NULL,
  embedding BLOB
);

CREATE INDEX IF NOT EXISTS idx_learnings_created ON learnings(created_at);

-- Create learning categories table
CREATE TABLE IF NOT EXISTS learning_categories (
  category_id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  created_at DATETIME NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_learning_categories_name ON learning_categories(name);

-- Create learning category assignments (many-to-many)
CREATE TABLE IF NOT EXISTS learning_category_assignments (
  learning_id TEXT NOT NULL,
  category_id TEXT NOT NULL,

  PRIMARY KEY (learning_id, category_id),
  FOREIGN KEY (learning_id) REFERENCES learnings(learning_id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES learning_categories(category_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_lca_learning ON learning_category_assignments(learning_id);
CREATE INDEX IF NOT EXISTS idx_lca_category ON learning_category_assignments(category_id);

-- Create learning sources table (links to conversations)
CREATE TABLE IF NOT EXISTS learning_sources (
  learning_id TEXT NOT NULL,
  conversation_uuid TEXT NOT NULL,

  PRIMARY KEY (learning_id, conversation_uuid),
  FOREIGN KEY (learning_id) REFERENCES learnings(learning_id) ON DELETE CASCADE,
  FOREIGN KEY (conversation_uuid) REFERENCES conversations(uuid) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_learning_sources_learning ON learning_sources(learning_id);
CREATE INDEX IF NOT EXISTS idx_learning_sources_conversation ON learning_sources(conversation_uuid);
