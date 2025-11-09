/**
 * Core type definitions for LLM Archive
 */

// ============================================================================
// Embedding Model
// ============================================================================

/**
 * Generates vector embeddings for text using an external API.
 * Implementations: GeminiEmbedding, (future: OpenAIEmbedding)
 */
export interface EmbeddingModel {
  /**
   * Generate embedding for a single text string.
   * @param text - Input text to embed
   * @returns Float32Array of embedding vector
   */
  embed(text: string): Promise<Float32Array>

  /**
   * Generate embeddings for multiple texts in a batch.
   * More efficient for bulk processing.
   * @param texts - Array of input texts
   * @returns Array of embedding vectors
   */
  embedBatch(texts: string[]): Promise<Float32Array[]>

  /**
   * Number of dimensions in the embedding vectors.
   * This is the source of truth for vector dimensionality.
   */
  readonly dimensions: number
}

// ============================================================================
// Vector Store
// ============================================================================

/**
 * Stores and searches vector embeddings using SQLite with sqlite-vec.
 * Dimension-agnostic until initialized by embedding provider.
 */
export interface VectorStore {
  /**
   * Initialize the vector store with specific dimensions.
   * Must be called before insert/search operations.
   * @param dimensions - Vector dimensionality (e.g., 768)
   */
  initialize(dimensions: number): void

  /**
   * Get current dimensions, or null if not initialized.
   */
  getDimensions(): number | null

  /**
   * Insert a vector into the store.
   * @param id - Unique identifier (message UUID)
   * @param vector - Embedding vector (must match initialized dimensions)
   */
  insert(id: string, vector: Float32Array): void

  /**
   * Search for similar vectors using cosine similarity.
   * @param query - Query vector (must match initialized dimensions)
   * @param limit - Maximum number of results to return
   * @returns Array of search results with IDs and similarity scores
   */
  search(query: Float32Array, limit: number): VectorSearchResult[]
}

export interface VectorSearchResult {
  id: string          // Message UUID
  score: number       // Similarity score (0-1, higher = more similar)
  distance: number    // Vector distance
}

// ============================================================================
// Conversation Importer
// ============================================================================

/**
 * Imports conversations from platform-specific export formats.
 * Normalizes to a common format for storage.
 * Implementations: ClaudeImporter, (future: OpenAIImporter)
 */
export interface ConversationImporter {
  /**
   * Platform identifier (e.g., "claude", "openai")
   */
  readonly platform: string

  /**
   * Import conversations from an export file.
   * Uses async generator for streaming large files.
   * @param filePath - Path to export file (e.g., conversations.json)
   * @yields Normalized conversations one at a time
   */
  import(filePath: string): AsyncGenerator<Conversation>
}

// ============================================================================
// Search Engine
// ============================================================================

/**
 * Orchestrates semantic search by coordinating embedding and vector search.
 * Enriches results with conversation context.
 */
export interface SearchEngine {
  /**
   * Search for conversations/messages matching a query.
   * @param query - Natural language search query
   * @param options - Search options (filters, limits, etc.)
   * @returns Array of search results with context
   */
  search(query: string, options: SearchOptions): Promise<SearchResult[]>
}

export interface SearchOptions {
  /**
   * Maximum number of results to return (default: 20)
   */
  limit?: number

  /**
   * Filter by date range
   */
  dateRange?: {
    start: Date
    end: Date
  }

  /**
   * Filter by sender (human or assistant)
   */
  sender?: 'human' | 'assistant'

  /**
   * Filter by conversation UUIDs
   */
  conversationUuids?: string[]
}

// ============================================================================
// Data Structures
// ============================================================================

/**
 * Platform-agnostic representation of a conversation.
 * All importers must convert to this format.
 */
export interface Conversation {
  uuid: string
  title: string
  summary?: string                // Platform-generated summary
  platform: string                // "claude", "openai", etc.
  messages: Message[]
  createdAt: Date
  updatedAt: Date
  metadata: Record<string, any>   // Platform-specific fields
}

/**
 * Platform-agnostic representation of a message.
 * Complex content structures are flattened to searchable text.
 */
export interface Message {
  uuid: string
  conversationUuid: string
  conversationIndex: number       // Position in conversation (0-indexed)
  sender: 'human' | 'assistant'
  text: string                    // Flattened, searchable text content
  createdAt: Date
  metadata: Record<string, any>   // Platform-specific fields
}

/**
 * Search result with conversation context.
 * Includes surrounding messages for multi-turn understanding.
 */
export interface SearchResult {
  message: Message                // The matched message
  conversation: {                 // Parent conversation metadata
    uuid: string
    title: string
    summary?: string
    createdAt: Date
    platform: string
  }
  score: number                   // Relevance score (0-1)

  // Context: surrounding messages
  previousMessages: Message[]     // Messages before match in conversation
  nextMessages: Message[]         // Messages after match
}

// ============================================================================
// Configuration
// ============================================================================

export interface Config {
  embedding: EmbeddingConfig
  db: DatabaseConfig
  search: SearchConfig
  ingestion: IngestionConfig
}

export interface EmbeddingConfig {
  provider: 'gemini' | 'openai'
  apiKey: string
  model: string
  dimensions: number
  batchSize?: number
  rateLimitDelayMs?: number
}

export interface DatabaseConfig {
  path: string
}

export interface SearchConfig {
  defaultLimit: number
  contextWindow: {
    before: number
    after: number
  }
}

export interface IngestionConfig {
  batchSize: number
  progressLogging: boolean
}
