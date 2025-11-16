import Database from 'better-sqlite3'
import { initializeSchema, validateLearningsSchema } from './schema'

/**
 * Create and initialize a database connection
 */
export function createDatabase(path: string): Database.Database {
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
