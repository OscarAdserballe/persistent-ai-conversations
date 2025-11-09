import Database from 'better-sqlite3'
import { VectorStore, VectorSearchResult } from '../core/types'

/**
 * SQLite + vector similarity implementation of VectorStore.
 * Searches message_chunks table and aggregates results by message UUID.
 * Stores embeddings as BLOBs and performs cosine similarity search in-memory.
 */
export class SqliteVectorStore implements VectorStore {
  private dimensions: number | null = null

  constructor(private db: Database.Database) {}

  initialize(dimensions: number): void {
    if (this.dimensions !== null && this.dimensions !== dimensions) {
      throw new Error(
        `Already initialized with ${this.dimensions} dimensions, cannot reinitialize with ${dimensions}`
      )
    }
    this.dimensions = dimensions
  }

  getDimensions(): number | null {
    return this.dimensions
  }

  insert(id: string, vector: Float32Array): void {
    // This method is no longer used - chunks are inserted directly via SQL in ingest.ts
    // Keeping for interface compatibility
    throw new Error('insert() is deprecated - use direct SQL INSERT_CHUNK instead')
  }

  search(query: Float32Array, limit: number): VectorSearchResult[] {
    if (this.dimensions === null) {
      throw new Error('VectorStore not initialized. Call initialize() first.')
    }

    if (query.length !== this.dimensions) {
      throw new Error(
        `Query vector dimension mismatch: expected ${this.dimensions}, got ${query.length}`
      )
    }

    // Fetch all chunks with embeddings
    const stmt = this.db.prepare(
      'SELECT message_uuid, chunk_index, embedding FROM message_chunks WHERE embedding IS NOT NULL'
    )
    const rows = stmt.all() as Array<{ message_uuid: string; chunk_index: number; embedding: Buffer }>

    if (rows.length === 0) {
      return []
    }

    // Compute cosine similarity for each chunk
    interface ChunkResult {
      messageUuid: string
      chunkIndex: number
      score: number
    }

    const chunkResults: ChunkResult[] = []

    for (const row of rows) {
      const vector = new Float32Array(row.embedding.buffer)
      const score = this.cosineSimilarity(query, vector)

      chunkResults.push({
        messageUuid: row.message_uuid,
        chunkIndex: row.chunk_index,
        score
      })
    }

    // Aggregate by message UUID - take MAX score across all chunks
    const messageScores = new Map<string, number>()

    for (const result of chunkResults) {
      const existingScore = messageScores.get(result.messageUuid)
      if (existingScore === undefined || result.score > existingScore) {
        messageScores.set(result.messageUuid, result.score)
      }
    }

    // Convert to VectorSearchResult format
    const results: VectorSearchResult[] = Array.from(messageScores.entries()).map(([id, score]) => ({
      id,
      score,
      distance: 1 - score
    }))

    // Sort by score (descending) and limit
    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
  }

  /**
   * Compute cosine similarity between two vectors
   */
  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    let dotProduct = 0
    let normA = 0
    let normB = 0

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i]
      normA += a[i] * a[i]
      normB += b[i] * b[i]
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB)

    // Avoid division by zero
    if (denominator === 0) {
      return 0
    }

    return dotProduct / denominator
  }
}
