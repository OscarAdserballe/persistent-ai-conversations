import Database from 'better-sqlite3'
import { Config } from '../core/types'
import { EmbeddingModel, VectorStore, SearchEngine, ConversationImporter } from '../core/types'
import { GeminiEmbedding } from '../embeddings/gemini'
import { SqliteVectorStore } from '../db/vector-store'
import { SemanticSearch } from '../search/semantic'
import { ClaudeImporter } from '../importers/claude'
import { createDatabase } from '../db/database'

/**
 * Factory for creating embedding models based on config.
 */
export function createEmbeddingModel(config: Config): EmbeddingModel {
  switch (config.embedding.provider) {
    case 'gemini':
      return new GeminiEmbedding({
        apiKey: config.embedding.apiKey,
        model: config.embedding.model,
        batchSize: config.embedding.batchSize,
        rateLimitDelayMs: config.embedding.rateLimitDelayMs
      })

    // Future:
    // case 'openai':
    //   return new OpenAIEmbedding(config.embedding)

    default:
      throw new Error(`Unknown embedding provider: ${config.embedding.provider}`)
  }
}

/**
 * Factory for creating vector store with database connection.
 */
export function createVectorStore(db: Database.Database): VectorStore {
  return new SqliteVectorStore(db)
}

/**
 * Factory for creating fully-wired search engine.
 * Coordinates embedding model and vector store dimensions.
 */
export function createSearchEngine(config: Config, db?: Database.Database): SearchEngine {
  const database = db || createDatabase(config.db.path)
  const embedder = createEmbeddingModel(config)
  const vectorStore = createVectorStore(database)

  return new SemanticSearch(
    embedder,
    vectorStore,
    database,
    config.search.contextWindow
  )
}

/**
 * Factory for creating conversation importers.
 */
export function createImporter(platform: string): ConversationImporter {
  switch (platform) {
    case 'claude':
      return new ClaudeImporter()

    // Future:
    // case 'openai':
    //   return new OpenAIImporter()

    default:
      throw new Error(`Unknown platform: ${platform}`)
  }
}
