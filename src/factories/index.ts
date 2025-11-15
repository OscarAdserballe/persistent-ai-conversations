import Database from 'better-sqlite3'
import { Config } from '../core/types'
import {
  EmbeddingModel,
  VectorStore,
  VectorStoreExtended,
  SearchEngine,
  ConversationImporter,
  LLMModel,
  LearningExtractor,
  LearningSearch
} from '../core/types'
import { GeminiEmbedding } from '../embeddings/gemini'
import { SqliteVectorStore } from '../db/vector-store'
import { SemanticSearch } from '../search/semantic'
import { ClaudeImporter } from '../importers/claude'
import { GeminiFlash } from '../llm/gemini-flash'
import { LearningExtractorImpl } from '../services/learning-extractor'
import { LearningSearchImpl } from '../services/learning-search'
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
export function createVectorStore(db: Database.Database): VectorStoreExtended {
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

/**
 * Factory for creating LLM models for text generation.
 * Separate from createEmbeddingModel (different purpose).
 */
export function createLLMModel(config: Config): LLMModel {
  switch (config.llm.provider) {
    case 'gemini':
      return new GeminiFlash({
        apiKey: config.llm.apiKey,
        model: config.llm.model,
        temperature: config.llm.temperature,
        maxTokens: config.llm.maxTokens,
        rateLimitDelayMs: config.llm.rateLimitDelayMs
      })

    // Future:
    // case 'openai':
    //   return new GPT4oMini(config.llm)
    // case 'anthropic':
    //   return new ClaudeHaiku(config.llm)

    default:
      throw new Error(`Unknown LLM provider: ${config.llm.provider}`)
  }
}

/**
 * Factory for creating fully-wired learning extractor.
 * Coordinates LLM, embedder, vector store, and database.
 */
export function createLearningExtractor(config: Config, db?: Database.Database): LearningExtractor {
  const database = db || createDatabase(config.db.path)
  const llm = createLLMModel(config)
  const embedder = createEmbeddingModel(config)
  const vectorStore = createVectorStore(database)

  // Initialize vector store with embedding dimensions
  vectorStore.initialize(embedder.dimensions)

  return new LearningExtractorImpl(llm, embedder, vectorStore, database)
}

/**
 * Factory for creating learning search engine.
 * Reuses existing VectorStore infrastructure.
 */
export function createLearningSearch(config: Config, db?: Database.Database): LearningSearch {
  const database = db || createDatabase(config.db.path)
  const embedder = createEmbeddingModel(config)
  const vectorStore = createVectorStore(database)

  // Initialize vector store with embedding dimensions
  vectorStore.initialize(embedder.dimensions)

  return new LearningSearchImpl(embedder, vectorStore, database)
}
