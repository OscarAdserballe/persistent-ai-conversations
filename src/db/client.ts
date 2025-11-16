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

  // Try various paths to find the raw Database instance
  const candidates = [
    anyDb._.session?.client,  // drizzle-orm 0.44+ newer structure
    anyDb._.session,           // drizzle-orm 0.44+
    anyDb.session?.client,     // With client wrapper
    anyDb.session?.db,         // Older structure
    anyDb.session,             // Direct session
    anyDb.client               // Direct client
  ]

  for (const candidate of candidates) {
    if (candidate && typeof candidate.exec === 'function' && typeof candidate.prepare === 'function') {
      return candidate as Database.Database
    }
  }

  throw new Error('Unable to extract raw better-sqlite3 instance from Drizzle database')
}
