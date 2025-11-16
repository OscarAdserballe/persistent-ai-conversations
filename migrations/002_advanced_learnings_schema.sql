-- Migration: Advanced Learnings Schema
-- Date: 2025-11-15
-- Description: Migrate from basic 5-column learnings table to advanced 15-column epistemic introspection schema
--
-- ⚠️  WARNING: This migration DROPS the existing learnings table and all its data!
--
-- If you have existing learnings data you want to preserve, DO NOT run this migration.
-- Instead, you'll need to write a custom migration script to transform your old data
-- to the new schema format.
--
-- For most users starting fresh or in early development, this destructive migration is fine.

-- Step 1: Drop the old learnings table (if it exists)
DROP TABLE IF EXISTS learnings;

-- Step 2: Create new advanced learnings schema
-- This schema supports epistemic introspection with:
-- - Core fields: title, context, insight, why, implications
-- - Structured tags (JSON array)
-- - Abstraction ladder: concrete → pattern → principle (JSON object)
-- - Understanding assessment: confidence, can_teach_it, known_gaps (JSON object)
-- - Effort tracking: processing_time, cognitive_load (JSON object)
-- - Emotional resonance: intensity, valence (JSON object)
-- - Classification: learning_type (principle, method, anti_pattern, exception)
-- - Source tracking: conversation_uuid (foreign key to conversations)
-- - Vector embedding for semantic search

CREATE TABLE IF NOT EXISTS learnings (
  -- Primary key
  learning_id TEXT PRIMARY KEY,

  -- Core fields (required)
  title TEXT NOT NULL,
  context TEXT NOT NULL,        -- What triggered this learning?
  insight TEXT NOT NULL,         -- The actual discovery or learning
  why TEXT NOT NULL,             -- Explanation of WHY this is true
  implications TEXT NOT NULL,    -- Concrete applications

  -- Tags (JSON array of strings)
  tags TEXT NOT NULL,            -- JSON: ["tag1", "tag2", "tag3"]

  -- Abstraction Ladder (JSON object)
  abstraction TEXT NOT NULL,     -- JSON: {concrete: "...", pattern: "...", principle?: "..."}

  -- Understanding Assessment (JSON object)
  understanding TEXT NOT NULL,   -- JSON: {confidence: 1-10, canTeachIt: bool, knownGaps?: [...]}

  -- Effort Tracking (JSON object)
  effort TEXT NOT NULL,          -- JSON: {processingTime: "5min"|"30min"|"2hr"|"days", cognitiveLoad: "easy"|"moderate"|"hard"|"breakthrough"}

  -- Emotional Resonance (JSON object)
  resonance TEXT NOT NULL,       -- JSON: {intensity: 1-10, valence: "positive"|"negative"|"mixed"}

  -- Classification (optional)
  learning_type TEXT,            -- principle | method | anti_pattern | exception
  source_credit TEXT,            -- If learned from external source

  -- Source tracking
  conversation_uuid TEXT,        -- Links to conversations table

  -- Vector embedding for semantic search
  embedding BLOB NOT NULL,

  -- Timestamps
  created_at DATETIME NOT NULL,

  -- Constraints
  CHECK (learning_type IN ('principle', 'method', 'anti_pattern', 'exception', NULL)),

  -- Foreign key to conversations
  FOREIGN KEY (conversation_uuid) REFERENCES conversations(uuid) ON DELETE SET NULL
);

-- Step 3: Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_learnings_created_at ON learnings(created_at);
CREATE INDEX IF NOT EXISTS idx_learnings_conversation_uuid ON learnings(conversation_uuid);
CREATE INDEX IF NOT EXISTS idx_learnings_learning_type ON learnings(learning_type);

-- Migration complete!
--
-- Next steps:
-- 1. Run: npm run extract-learnings
-- 2. This will populate the new learnings table with extracted learnings from your conversations
