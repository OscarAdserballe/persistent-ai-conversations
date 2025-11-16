import Database from 'better-sqlite3'
import { mkdirSync } from 'fs'
import { dirname } from 'path'
import { initializeSchema, validateLearningsSchema } from './schema'

/**
 * Create and initialize a database connection
 */
export function createDatabase(path: string): Database.Database {
  // Ensure parent directory exists (especially important for CI/test environments)
  const dir = dirname(path)
  mkdirSync(dir, { recursive: true })

  const db = new Database(path)

  // Enable Write-Ahead Logging for better concurrency
  db.pragma('journal_mode = WAL')

  // Initialize schema (creates tables if they don't exist)
  initializeSchema(db)

  // Validate learnings schema (fails fast if outdated schema detected)
  validateLearningsSchema(db)

  return db
}

/**
 * Close database connection
 */
export function closeDatabase(db: Database.Database): void {
  db.close()
}
