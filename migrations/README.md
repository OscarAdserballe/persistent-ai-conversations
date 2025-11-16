# Database Migrations

This folder contains SQL migration scripts for updating the database schema.

## Migration Naming Convention

Migrations are numbered sequentially:
- `001_description.sql` - First migration
- `002_description.sql` - Second migration
- etc.

## Running Migrations

### Apply a specific migration:
```bash
sqlite3 ./data/conversations.db < migrations/001_update_learnings_schema.sql
```

### Apply all migrations (in order):
```bash
for migration in migrations/*.sql; do
  echo "Applying $migration..."
  sqlite3 ./data/conversations.db < "$migration"
done
```

## Schema Validation

**NEW:** The application now validates database schema on startup!

If you try to run the application with an outdated database schema, you'll see a clear error message:

```
❌ Database schema is outdated!

The 'learnings' table is missing required columns: context, insight, why, ...
```

This prevents cryptic errors and guides you through the migration process.

## Current Migrations

### 001_update_learnings_schema.sql (DEPRECATED)
**Status:** ⚠️ **DO NOT USE** - This migration is outdated!
**Date:** 2025-11-11

This migration has been superseded by `002_advanced_learnings_schema.sql`. It creates an obsolete schema that is no longer compatible with the current codebase.

**For historical reference only.**

---

### 002_advanced_learnings_schema.sql (CURRENT)
**Status:** ✅ **Active - Use this migration**
**Date:** 2025-11-15
**Description:** Implements advanced epistemic introspection schema for learnings

**Changes:**
- Drops old learnings table (5 columns)
- Creates new advanced schema (15+ columns)
- Core fields: title, context, insight, why, implications
- Structured data stored as JSON:
  - `tags` - JSON array of strings
  - `abstraction` - Abstraction ladder (concrete → pattern → principle)
  - `understanding` - Confidence, can_teach_it, known_gaps
  - `effort` - Processing time, cognitive load
  - `resonance` - Emotional intensity and valence
- Classification: learning_type (principle/method/anti_pattern/exception)
- Source tracking: conversation_uuid (foreign key)
- Vector embedding for semantic search

**⚠️ WARNING:** This migration drops existing learnings data!

**How to apply:**
```bash
# 1. Backup first!
cp ./data/conversations.db ./data/conversations.db.backup

# 2. Run migration
sqlite3 ./data/conversations.db < migrations/002_advanced_learnings_schema.sql

# 3. Re-extract learnings
npm run extract-learnings
```

## Best Practices

1. **Always backup your database before running migrations:**
   ```bash
   cp ./data/conversations.db ./data/conversations.db.backup
   ```

2. **Test migrations on a copy first:**
   ```bash
   cp ./data/conversations.db ./data/test.db
   sqlite3 ./data/test.db < migrations/001_update_learnings_schema.sql
   ```

3. **Document breaking changes** in the migration file header

4. **Version control all migrations** - never modify existing migration files, create new ones instead

## Checking Current Schema

```bash
# View all tables
sqlite3 ./data/conversations.db ".tables"

# View specific table schema
sqlite3 ./data/conversations.db ".schema learnings"

# Check if migration was applied (look for new columns/tables)
sqlite3 ./data/conversations.db "PRAGMA table_info(learnings);"
```
