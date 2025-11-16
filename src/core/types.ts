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
  id: string          // Entity ID (message UUID, learning ID, etc.)
  score: number       // Similarity score (0-1, higher = more similar)
  distance: number    // Vector distance
}

/**
 * Search a specific table for similar vectors.
 * Added for learning extraction feature.
 * @param tableName - Table to search ('message_chunks' or 'learnings')
 * @param idColumn - ID column name ('message_uuid' or 'learning_id')
 * @param query - Query vector
 * @param limit - Maximum results
 */
export interface VectorStoreExtended extends VectorStore {
  searchTable(
    tableName: string,
    idColumn: string,
    query: Float32Array,
    limit: number
  ): VectorSearchResult[]
}

// ============================================================================
// LLM Model
// ============================================================================

/**
 * Interface for text generation using LLM APIs.
 * Used for learning extraction (not embeddings).
 * Implementations: GeminiFlash, (future: GPT4oMini, ClaudeHaiku)
 */
export interface LLMModel {
  /**
   * Generate text based on a prompt.
   * @param prompt - The instruction prompt
   * @param context - Optional context (e.g., full conversation)
   * @returns Generated text (typically JSON)
   */
  generateText(prompt: string, context?: string): Promise<string>

  /**
   * Generate structured output with schema validation.
   * @param prompt - The instruction prompt
   * @param context - Optional context (e.g., full conversation)
   * @param responseSchema - Schema definition in provider-specific format
   * @returns Parsed object matching the schema
   */
  generateStructuredOutput<T>(prompt: string, context: string | undefined, responseSchema: any): Promise<T>

  /**
   * Model identifier (e.g., "gemini-1.5-flash")
   */
  readonly model: string
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
// Learning Extraction (Advanced Schema)
// ============================================================================

/**
 * Extracts distilled learnings from conversations using LLM.
 * Stores learnings with embeddings and source references.
 */
export interface LearningExtractor {
  /**
   * Extract learnings from a single conversation.
   * @param conversation - Full conversation with messages
   * @returns Array of extracted learnings (empty if none found)
   */
  extractFromConversation(conversation: Conversation): Promise<Learning[]>
}

/**
 * A distilled learning extracted from conversations.
 * Uses advanced epistemic introspection framework.
 */
export interface Learning {
  learningId: string             // Unique learning ID (UUID)

  // Core learning capture
  title: string                  // Scannable summary (max 100 chars)
  context: string                // What triggered this learning
  insight: string                // What was discovered
  why: string                    // Explanation of WHY this is true
  implications: string           // When/how to apply this
  tags: string[]                 // Free-form tags for retrieval

  // Abstraction ladder
  abstraction: Abstraction

  // Metacognitive assessment
  understanding: Understanding

  // Learning effort
  effort: Effort

  // Emotional context
  resonance: Resonance

  // Learning classification
  learningType?: LearningType
  sourceCredit?: string          // If insight came from someone else

  // Source tracking (simplified)
  conversationUuid?: string      // Source conversation

  // Metadata
  createdAt: Date
  embedding?: Float32Array       // Vector embedding (populated separately)
}

/**
 * Abstraction ladder: concrete → pattern → principle
 */
export interface Abstraction {
  concrete: string               // Specific instance or example
  pattern: string                // Generalizable pattern
  principle?: string             // Universal principle (optional)
}

/**
 * Metacognitive assessment of understanding depth
 */
export interface Understanding {
  confidence: number             // 1-10: How well you understand this
  canTeachIt: boolean            // Could you explain it to someone else?
  knownGaps?: string[]           // What you still don't understand
}

/**
 * Learning effort tracking
 */
export interface Effort {
  processingTime: ProcessingTime
  cognitiveLoad: CognitiveLoad
}

/**
 * Emotional resonance tracking
 */
export interface Resonance {
  intensity: number              // 1-10: How much this hit you
  valence: Valence               // How it felt
}

// Type definitions
export type LearningType = 'principle' | 'method' | 'anti_pattern' | 'exception'
export type ProcessingTime = '5min' | '30min' | '2hr' | 'days'
export type CognitiveLoad = 'easy' | 'moderate' | 'hard' | 'breakthrough'
export type Valence = 'positive' | 'negative' | 'mixed'

/**
 * Semantic search over learnings.
 * Uses VectorStore for core search, enriches with domain-specific data.
 */
export interface LearningSearch {
  /**
   * Search for learnings matching a query.
   * @param query - Natural language search query
   * @param options - Search options (optional)
   * @returns Array of search results with source context
   */
  search(query: string, options?: LearningSearchOptions): Promise<LearningSearchResult[]>
}

export interface LearningSearchOptions {
  limit?: number                 // Default: 20
  dateRange?: {                  // Filter by learning creation date
    start: Date
    end: Date
  }
  tags?: string[]                // Filter by tags (OR matching)
  learningType?: LearningType    // Filter by learning type
}

export interface LearningSearchResult {
  learning: Learning             // The matched learning
  score: number                  // Similarity score (0-1)
  sourceConversation?: {         // Source conversation metadata
    uuid: string
    title: string
    createdAt: Date
  }
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
  llm: LLMConfig
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

export interface LLMConfig {
  provider: 'gemini' | 'openai' | 'anthropic'
  apiKey: string
  model: string
  temperature?: number
  maxTokens?: number
  rateLimitDelayMs?: number     // Delay between LLM calls (default: 1000ms)
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
