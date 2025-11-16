import { VectorStoreExtended, VectorSearchResult } from '../core/types'

/**
 * Mock vector store for testing.
 * Uses in-memory Map for storage and simple cosine similarity for search.
 */
export class MockVectorStore implements VectorStoreExtended {
  private dimensions: number | null = null
  private vectors = new Map<string, Float32Array>()

  initialize(dimensions: number): void {
    if (this.dimensions !== null && this.dimensions !== dimensions) {
      throw new Error(`Already initialized with ${this.dimensions} dimensions`)
    }
    this.dimensions = dimensions
  }

  getDimensions(): number | null {
    return this.dimensions
  }

  insert(id: string, vector: Float32Array): void {
    if (this.dimensions === null) {
      throw new Error('VectorStore not initialized')
    }
    if (vector.length !== this.dimensions) {
      throw new Error(`Expected ${this.dimensions} dimensions, got ${vector.length}`)
    }
    this.vectors.set(id, vector)
  }

  search(query: Float32Array, limit: number): VectorSearchResult[] {
    if (this.dimensions === null) {
      throw new Error('VectorStore not initialized')
    }
    if (query.length !== this.dimensions) {
      throw new Error(`Query vector has wrong dimensions: ${query.length} vs ${this.dimensions}`)
    }

    // Compute cosine similarity for all vectors
    const results: VectorSearchResult[] = []

    for (const [id, vector] of this.vectors.entries()) {
      const score = this.cosineSimilarity(query, vector)
      const distance = 1 - score // Convert similarity to distance
      results.push({ id, score, distance })
    }

    // Sort by score (descending) and limit
    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
  }

  searchTable(
    tableName: string,
    idColumn: string,
    query: Float32Array,
    limit: number
  ): VectorSearchResult[] {
    // In the mock, we don't distinguish between tables
    // Just delegate to regular search
    return this.search(query, limit)
  }

  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    let dotProduct = 0
    let normA = 0
    let normB = 0

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i]
      normA += a[i] * a[i]
      normB += b[i] * b[i]
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
  }

  // Test helpers
  clear() {
    this.vectors.clear()
  }

  size(): number {
    return this.vectors.size
  }

  get data(): Map<string, Float32Array> {
    return this.vectors
  }
}
