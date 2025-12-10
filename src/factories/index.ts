import Database from "better-sqlite3";
import { Config } from "../core/types";
import {
  EmbeddingModel,
  VectorStore,
  VectorStoreExtended,
  SearchEngine,
  ConversationImporter,
  LearningExtractor,
  LearningSearch,
} from "../core/types";
import { GeminiEmbedding } from "../embeddings/gemini";
import { SqliteVectorStore } from "../db/vector-store";
import { SemanticSearch } from "../search/semantic";
import { ClaudeImporter } from "../importers/claude";
import { LearningExtractorImpl } from "../services/learning-extractor";
import { LearningSearchImpl } from "../services/learning-search";
import { createDrizzleDb, getRawDb, DrizzleDB } from "../db/client";
import { MockEmbeddingModel } from "../mocks";
import { mkdirSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { getModel } from "../llm/client";

/**
 * Get absolute path to migrations folder.
 * Works from any working directory by resolving relative to this file.
 * Falls back to relative path if import.meta.url is unavailable.
 */
function getMigrationsPath(): string {
  try {
    // Try to use import.meta.url (works in ESM, production)
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    // This file is at src/factories/index.ts, so go up two levels to project root
    const projectRoot = resolve(__dirname, "../..");
    return resolve(projectRoot, "migrations");
  } catch {
    // Fallback to relative path (works when running from project root, like in tests)
    return "./migrations";
  }
}

/**
 * Factory for creating embedding models based on config.
 */
export function createEmbeddingModel(config: Config): EmbeddingModel {
  switch (config.embedding.provider) {
    case "mock":
      return new MockEmbeddingModel();

    case "gemini":
      return new GeminiEmbedding({
        apiKey: config.embedding.apiKey,
        model: config.embedding.model,
        batchSize: config.embedding.batchSize,
        rateLimitDelayMs: config.embedding.rateLimitDelayMs,
      });

    // Future:
    // case 'openai':
    //   return new OpenAIEmbedding(config.embedding)

    default:
      throw new Error(
        `Unknown embedding provider: ${config.embedding.provider}`
      );
  }
}

/**
 * Factory for creating database connection.
 * Now returns Drizzle-wrapped database for type safety.
 * @param path - Path to SQLite database file
 * @returns DrizzleDB instance
 */
export function createDatabase(path: string): DrizzleDB {
  // Ensure parent directory exists (especially important for CI/test environments)
  if (path !== ":memory:") {
    const dir = dirname(path);
    mkdirSync(dir, { recursive: true });
  }

  const db = createDrizzleDb(path);

  // Run Drizzle migrations to create base tables
  // Use absolute path to migrations folder (works from any working directory)
  migrate(db, { migrationsFolder: getMigrationsPath() });

  // Create FTS5 tables and triggers (Drizzle doesn't support FTS5 yet)
  const rawDb = getRawDb(db);

  // Initialize FTS5 tables and triggers
  rawDb.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS conversations_fts USING fts5(
      uuid UNINDEXED,
      name,
      summary,
      content=conversations,
      content_rowid=rowid
    );
  `);

  rawDb.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      uuid UNINDEXED,
      text,
      content=messages,
      content_rowid=rowid
    );
  `);

  // Create FTS triggers
  rawDb.exec(`
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
  `);

  return db;
}

/**
 * Factory for creating vector store with database connection.
 * Accepts DrizzleDB or raw Database for backward compatibility.
 * @param db - DrizzleDB or raw better-sqlite3 Database
 */
export function createVectorStore(
  db: DrizzleDB | Database.Database
): VectorStoreExtended {
  // Check if it's already a raw Database instance
  const rawDb = (db as Database.Database).prepare
    ? (db as Database.Database)
    : getRawDb(db as DrizzleDB);
  return new SqliteVectorStore(rawDb);
}

/**
 * Factory for creating fully-wired search engine.
 * Coordinates embedding model and vector store dimensions.
 */
export function createSearchEngine(
  config: Config,
  db?: DrizzleDB
): SearchEngine {
  const database = db || createDatabase(config.db.path);
  const embedder = createEmbeddingModel(config);
  const vectorStore = createVectorStore(database);

  return new SemanticSearch(
    embedder,
    vectorStore,
    database,
    config.search.contextWindow
  );
}

/**
 * Factory for creating conversation importers.
 */
export function createImporter(platform: string): ConversationImporter {
  switch (platform) {
    case "claude":
      return new ClaudeImporter();

    // Future:
    // case 'openai':
    //   return new OpenAIImporter()

    default:
      throw new Error(`Unknown platform: ${platform}`);
  }
}

/**
 * Factory for creating fully-wired learning extractor.
 * Coordinates LLM, embedder, vector store, and database.
 */
export function createLearningExtractor(
  config: Config,
  db?: DrizzleDB,
  promptTemplate?: string
): LearningExtractor {
  const database = db || createDatabase(config.db.path);
  const embedder = createEmbeddingModel(config);
  const vectorStore = createVectorStore(database);

  // Initialize vector store with embedding dimensions
  vectorStore.initialize(embedder.dimensions);

  // Create Vercel AI SDK model instance via simplified client
  // Use configured model name or default to gemini
  const modelName = config.llm.model || "google/gemini-flash-1.5";
  const llm = getModel(modelName);

  // Pass DrizzleDB directly - service uses type-safe queries now!
  if (!promptTemplate) {
    throw new Error(
      "createLearningExtractor requires a prompt template. Fetch it (e.g., via getLangfusePrompt) before calling this factory."
    );
  }

  return new LearningExtractorImpl(llm, embedder, database, promptTemplate);
}

/**
 * Factory for creating learning search engine.
 * Reuses existing VectorStore infrastructure.
 */
export function createLearningSearch(
  config: Config,
  db?: DrizzleDB
): LearningSearch {
  const database = db || createDatabase(config.db.path);
  const embedder = createEmbeddingModel(config);
  const vectorStore = createVectorStore(database);

  // Initialize vector store with embedding dimensions
  vectorStore.initialize(embedder.dimensions);

  // Pass DrizzleDB directly - service uses type-safe queries now!
  return new LearningSearchImpl(embedder, vectorStore, database);
}
