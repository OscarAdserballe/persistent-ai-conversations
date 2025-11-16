import Database from 'better-sqlite3'
import { drizzle, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema'

export type DrizzleDB = BetterSQLite3Database<typeof schema>

/**
 * Create a Drizzle-wrapped database instance
 * @param dbPath - Path to the SQLite database file (or ':memory:' for in-memory)
 * @returns Drizzle database instance with type-safe queries
 */
export function createDrizzleDb(dbPath: string): DrizzleDB {
  const sqlite = new Database(dbPath)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')

  const db = drizzle(sqlite, { schema })
  return db
}

/**
 * Get the raw better-sqlite3 instance from a Drizzle database
 * Useful for operations not supported by Drizzle (FTS5, custom SQL, etc.)
 * @param db - Drizzle database instance
 * @returns Raw better-sqlite3 Database instance
 */
export function getRawDb(db: DrizzleDB): Database.Database {
  // Access the internal better-sqlite3 instance
  // Try multiple access patterns depending on drizzle-orm version
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDb = db as any

  // drizzle-orm 0.44+ structure: db._.session
  if (anyDb._ && anyDb._.session) {
    return anyDb._.session
  }

  // Older structure: db.session.db
  if (anyDb.session && anyDb.session.db) {
    return anyDb.session.db
  }

  // Direct session access
  if (anyDb.session) {
    return anyDb.session
  }

  throw new Error('Unable to extract raw better-sqlite3 instance from Drizzle database')
}
