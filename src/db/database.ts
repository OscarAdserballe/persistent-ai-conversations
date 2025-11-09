import Database from 'better-sqlite3'
import { initializeSchema } from './schema'

/**
 * Create and initialize a database connection
 */
export function createDatabase(path: string): Database.Database {
  const db = new Database(path)

  // Enable Write-Ahead Logging for better concurrency
  db.pragma('journal_mode = WAL')

  // Initialize schema
  initializeSchema(db)

  return db
}

/**
 * Close database connection
 */
export function closeDatabase(db: Database.Database): void {
  db.close()
}
