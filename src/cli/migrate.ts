#!/usr/bin/env node

import { Command } from "commander";
import { readdirSync, readFileSync, existsSync, mkdirSync } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import { loadConfig } from "../config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const program = new Command();

interface MigrationRecord {
  id: number;
  name: string;
  applied_at: number;
}

/**
 * Get all SQL migration files from the migrations directory.
 */
function getMigrationFiles(migrationsDir: string): string[] {
  if (!existsSync(migrationsDir)) {
    return [];
  }

  return readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql") && !f.startsWith("_"))
    .sort(); // Sort alphabetically (0000_, 0001_, etc.)
}

/**
 * Get list of already applied migrations from the database.
 */
function getAppliedMigrations(db: Database.Database): Set<string> {
  // Create migrations tracking table if it doesn't exist
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at INTEGER NOT NULL
    )
  `);

  const rows = db.prepare("SELECT name FROM _migrations").all() as MigrationRecord[];
  return new Set(rows.map((r) => r.name));
}

/**
 * Apply a single migration file.
 */
function applyMigration(db: Database.Database, migrationsDir: string, filename: string): void {
  const filepath = join(migrationsDir, filename);
  const sql = readFileSync(filepath, "utf-8");

  // Run in a transaction
  const transaction = db.transaction(() => {
    // Execute the migration SQL
    db.exec(sql);

    // Record the migration
    db.prepare("INSERT INTO _migrations (name, applied_at) VALUES (?, ?)").run(
      filename,
      Date.now()
    );
  });

  transaction();
}

program
  .name("migrate")
  .description("Run database migrations")
  .option("-c, --config <path>", "Path to config file", "./config.json")
  .option("--dry-run", "Show migrations that would be applied without running them")
  .option("--force <name>", "Force re-run a specific migration (dangerous!)")
  .action(
    async (options: { config: string; dryRun?: boolean; force?: string }) => {
      try {
        const config = loadConfig(options.config);
        const projectRoot = resolve(__dirname, "../..");
        const migrationsDir = join(projectRoot, "migrations");
        const dbPath = resolve(projectRoot, config.db.path);

        console.log(`Database: ${dbPath}`);
        console.log(`Migrations: ${migrationsDir}\n`);

        // Open database
        const db = new Database(dbPath);

        // Get migration status
        const migrationFiles = getMigrationFiles(migrationsDir);
        const appliedMigrations = getAppliedMigrations(db);

        // Find pending migrations
        const pendingMigrations = migrationFiles.filter(
          (f) => !appliedMigrations.has(f)
        );

        if (pendingMigrations.length === 0) {
          console.log("✓ All migrations are up to date\n");
          console.log(`Applied migrations: ${appliedMigrations.size}`);
          db.close();
          return;
        }

        console.log(`Pending migrations: ${pendingMigrations.length}`);
        for (const m of pendingMigrations) {
          console.log(`  - ${m}`);
        }
        console.log();

        if (options.dryRun) {
          console.log("(dry run - no changes made)");
          db.close();
          return;
        }

        // Apply migrations
        for (const migration of pendingMigrations) {
          console.log(`Applying: ${migration}...`);
          try {
            applyMigration(db, migrationsDir, migration);
            console.log(`  ✓ Applied`);
          } catch (error) {
            console.error(`  ✗ Failed: ${(error as Error).message}`);
            db.close();
            process.exit(1);
          }
        }

        console.log(`\n✓ Applied ${pendingMigrations.length} migrations`);
        db.close();
      } catch (error) {
        console.error(`\n❌ Migration failed: ${(error as Error).message}`);
        process.exit(1);
      }
    }
  );

program
  .command("mark-applied <migration>")
  .description("Mark migration(s) as applied without running them. Use 'all' to mark all.")
  .option("-c, --config <path>", "Path to config file", "./config.json")
  .action(async (migration: string, options: { config: string }) => {
    try {
      const config = loadConfig(options.config);
      const projectRoot = resolve(__dirname, "../..");
      const migrationsDir = join(projectRoot, "migrations");
      const dbPath = resolve(projectRoot, config.db.path);

      const db = new Database(dbPath);
      getAppliedMigrations(db); // Ensure table exists

      const migrationFiles = getMigrationFiles(migrationsDir);

      // Support marking "all" as applied
      if (migration === "all") {
        for (const file of migrationFiles) {
          try {
            db.prepare("INSERT INTO _migrations (name, applied_at) VALUES (?, ?)").run(
              file,
              Date.now()
            );
            console.log(`✓ Marked as applied: ${file}`);
          } catch {
            console.log(`  (already marked: ${file})`);
          }
        }
      } else {
        // Find the migration file
        const filename = migrationFiles.find(
          (f) => f === migration || f.includes(migration)
        );

        if (!filename) {
          console.error(`Migration not found: ${migration}`);
          console.log("Available migrations:");
          migrationFiles.forEach((f) => console.log(`  - ${f}`));
          process.exit(1);
        }

        db.prepare("INSERT INTO _migrations (name, applied_at) VALUES (?, ?)").run(
          filename,
          Date.now()
        );
        console.log(`✓ Marked as applied: ${filename}`);
      }

      db.close();
    } catch (error) {
      console.error(`\n❌ Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

program
  .command("status")
  .description("Show migration status")
  .option("-c, --config <path>", "Path to config file", "./config.json")
  .action(async (options: { config: string }) => {
    try {
      const config = loadConfig(options.config);
      const projectRoot = resolve(__dirname, "../..");
      const migrationsDir = join(projectRoot, "migrations");
      const dbPath = resolve(projectRoot, config.db.path);

      const db = new Database(dbPath);

      const migrationFiles = getMigrationFiles(migrationsDir);
      const appliedMigrations = getAppliedMigrations(db);

      console.log("Migration Status\n");
      console.log("Status  | Migration");
      console.log("--------|----------");

      for (const file of migrationFiles) {
        const status = appliedMigrations.has(file) ? "✓" : " ";
        console.log(`   ${status}   | ${file}`);
      }

      const pending = migrationFiles.filter((f) => !appliedMigrations.has(f));
      console.log(
        `\n${appliedMigrations.size} applied, ${pending.length} pending`
      );

      db.close();
    } catch (error) {
      console.error(`\n❌ Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

program.parse();
