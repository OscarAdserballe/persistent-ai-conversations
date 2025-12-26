/**
 * Core type definitions for LLM Archive
 */

// ============================================================================
// PDF Parser
// ============================================================================

/**
 * Parses PDF files and extracts text content.
 * Implementations: PdfParseParser
 */
export interface PDFParser {
  /**
   * Parse a PDF file and extract text content.
   * @param filePath - Path to PDF file
   * @returns Parsed PDF document with text and metadata
   */
  parse(filePath: string): Promise<ParsedPDF>;
}

export interface ParsedPDF {
  filename: string;
  title?: string;
  pageCount: number;
  text: string;
  pages: PDFPage[];
  metadata: Record<string, unknown>;
}

export interface PDFPage {
  pageNumber: number;
  text: string;
  charCount: number;
}

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
  embed(text: string): Promise<Float32Array>;

  /**
   * Generate embeddings for multiple texts in a batch.
   * More efficient for bulk processing.
   * @param texts - Array of input texts
   * @returns Array of embedding vectors
   */
  embedBatch(texts: string[]): Promise<Float32Array[]>;

  /**
   * Number of dimensions in the embedding vectors.
   * This is the source of truth for vector dimensionality.
   */
  readonly dimensions: number;
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
  initialize(dimensions: number): void;

  /**
   * Get current dimensions, or null if not initialized.
   */
  getDimensions(): number | null;

  /**
   * Insert a vector into the store.
   * @param id - Unique identifier (message UUID)
   * @param vector - Embedding vector (must match initialized dimensions)
   */
  insert(id: string, vector: Float32Array): void;

  /**
   * Search for similar vectors using cosine similarity.
   * @param query - Query vector (must match initialized dimensions)
   * @param limit - Maximum number of results to return
   * @returns Array of search results with IDs and similarity scores
   */
  search(query: Float32Array, limit: number): VectorSearchResult[];
}

export interface VectorSearchResult {
  id: string; // Entity ID (message UUID, learning ID, etc.)
  score: number; // Similarity score (0-1, higher = more similar)
  distance: number; // Vector distance
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
  ): VectorSearchResult[];
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
  readonly platform: string;

  /**
   * Import conversations from an export file.
   * Uses async generator for streaming large files.
   * @param filePath - Path to export file (e.g., conversations.json)
   * @yields Normalized conversations one at a time
   */
  import(filePath: string): AsyncGenerator<Conversation>;
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
  search(query: string, options: SearchOptions): Promise<SearchResult[]>;
}

export interface SearchOptions {
  /**
   * Maximum number of results to return (default: 20)
   */
  limit?: number;

  /**
   * Filter by date range
   */
  dateRange?: {
    start: Date;
    end: Date;
  };

  /**
   * Filter by sender (human or assistant)
   */
  sender?: "human" | "assistant";

  /**
   * Filter by conversation UUIDs
   */
  conversationUuids?: string[];
}

// ============================================================================
// Topic Extraction (PDF → Topics)
// ============================================================================

/**
 * Extracts topics from PDF documents using LLM.
 * Stores topics with embeddings for later search.
 */
export interface TopicExtractor {
  /**
   * Extract topics from a stored PDF document.
   * @param pdfId - UUID of the PDF document in database
   * @param options - Optional metadata for telemetry/experiments
   * @returns Array of extracted topics
   */
  extractFromPDF(
    pdfId: string,
    options?: TopicExtractionOptions
  ): Promise<Topic[]>;
}

export interface TopicExtractionOptions {
  experimentId?: string;
  promptVersion?: string;
  modelId?: string;
  /** If true, delete existing topics and re-extract */
  overwrite?: boolean;
}

/**
 * A topic extracted from a PDF document.
 */
export interface Topic {
  topicId: string;
  title: string;
  summary: string;
  keyPoints: string[];
  sourcePassages?: string[];
  sourceText?: string;
  pdfId: string;
  parentTopicId?: string;
  depth: number;
  createdAt: Date;
  embedding?: Float32Array;
}

// ============================================================================
// Learning Extraction (Block-based Schema for Flashcards)
// ============================================================================

/**
 * Extracts distilled learnings from conversations using LLM.
 * Stores learnings with embeddings and source references.
 */
export interface LearningExtractor {
  /**
   * Extract learnings from a single conversation.
   * @param conversation - Full conversation with messages
   * @param options - Optional metadata for telemetry/experiments
   * @returns Array of extracted learnings (empty if none found)
   */
  extractFromConversation(
    conversation: Conversation,
    options?: LearningExtractionOptions
  ): Promise<Learning[]>;
}

/**
 * Extracts learnings from topics (extracted from PDFs).
 */
export interface TopicLearningExtractor {
  /**
   * Extract learnings from a single topic.
   * @param topic - Topic with summary and key points
   * @param options - Optional metadata for telemetry/experiments
   * @returns Array of extracted learnings (0-N per topic)
   */
  extractFromTopic(
    topic: Topic,
    options?: LearningExtractionOptions
  ): Promise<Learning[]>;
}

export interface LearningExtractionOptions {
  experimentId?: string;
  promptVersion?: string;
  modelId?: string;
}

/**
 * Block types for flashcard content.
 * - 'qa': Generic question/answer (definitions, procedures, proofs, formulas)
 * - 'why': Elaborative interrogation ("Why is X true?")
 * - 'contrast': Compare/contrast two concepts
 */
export type ContentBlockType = "qa" | "why" | "contrast";

/**
 * A content block - a single Q&A pair that becomes a flashcard.
 */
export interface ContentBlock {
  blockType: ContentBlockType;
  question: string; // Front of flashcard
  answer: string; // Back of flashcard
}

/**
 * A distilled learning - the universal knowledge unit.
 * Can be extracted from conversations or topics (from PDFs).
 */
export interface Learning {
  learningId: string; // Unique learning ID (UUID)

  // Core learning capture
  title: string; // Descriptive title - highly specific for recall
  problemSpace: string; // "When/why does this matter?" - the situation making this relevant
  insight: string; // Core technical/philosophical realization (1-2 sentences)
  blocks: ContentBlock[]; // 0-N flashcard-ready Q&A pairs

  // Polymorphic source tracking (no FK - accepts orphan risk)
  sourceType: "conversation" | "topic";
  sourceId: string; // conversationUuid or topicId

  // Metadata
  createdAt: Date;
  embedding?: Float32Array; // Vector embedding (populated separately)
}

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
  search(
    query: string,
    options?: LearningSearchOptions
  ): Promise<LearningSearchResult[]>;
}

export interface LearningSearchOptions {
  limit?: number; // Default: 20
  dateRange?: {
    // Filter by learning creation date
    start: Date;
    end: Date;
  };
}

export interface LearningSearchResult {
  learning: Learning; // The matched learning
  score: number; // Similarity score (0-1)
  // Source metadata - one of these will be populated based on sourceType
  sourceConversation?: {
    uuid: string;
    title: string;
    createdAt: Date;
  };
  sourceTopic?: {
    topicId: string;
    title: string;
    pdfId: string;
    pdfTitle?: string;
  };
}

// ============================================================================
// Data Structures
// ============================================================================

/**
 * Platform-agnostic representation of a conversation.
 * All importers must convert to this format.
 */
export interface Conversation {
  uuid: string;
  title: string;
  summary?: string; // Platform-generated summary
  platform: string; // "claude", "openai", etc.
  messages: Message[];
  createdAt: Date;
  updatedAt: Date;
  metadata: Record<string, any>; // Platform-specific fields
}

/**
 * Platform-agnostic representation of a message.
 * Complex content structures are flattened to searchable text.
 */
export interface Message {
  uuid: string;
  conversationUuid: string;
  conversationIndex: number; // Position in conversation (0-indexed)
  sender: "human" | "assistant";
  text: string; // Flattened, searchable text content
  createdAt: Date;
  metadata: Record<string, any>; // Platform-specific fields
}

/**
 * Search result with conversation context.
 * Includes surrounding messages for multi-turn understanding.
 */
export interface SearchResult {
  message: Message; // The matched message
  conversation: {
    // Parent conversation metadata
    uuid: string;
    title: string;
    summary?: string;
    createdAt: Date;
    platform: string;
  };
  score: number; // Relevance score (0-1)

  // Context: surrounding messages
  previousMessages: Message[]; // Messages before match in conversation
  nextMessages: Message[]; // Messages after match
}

// ============================================================================
// Configuration
// ============================================================================

export interface Config {
  embedding: EmbeddingConfig;
  llm: LLMConfig;
  db: DatabaseConfig;
  search: SearchConfig;
  ingestion: IngestionConfig;
  prompts: PromptsConfig;
  server?: ServerConfig;
}

export interface EmbeddingConfig {
  provider: "gemini" | "openai" | "mock";
  apiKey: string;
  model: string;
  dimensions: number;
  batchSize?: number;
  rateLimitDelayMs?: number;
}

export interface LLMConfig {
  provider: "gemini" | "openai" | "anthropic" | "mock";
  apiKey: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  rateLimitDelayMs?: number; // Delay between LLM calls (default: 1000ms)
}

export interface DatabaseConfig {
  path: string;
}

export interface SearchConfig {
  defaultLimit: number;
  contextWindow: {
    before: number;
    after: number;
  };
}

export interface IngestionConfig {
  batchSize: number;
  progressLogging: boolean;
  concurrency: number;
}

export interface PromptsConfig {
  learningExtraction: string;
}
export interface ServerConfig {
  port: number;
  host?: string;
  cors?: {
    origin: string;
  };
}
