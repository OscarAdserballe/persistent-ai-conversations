import { EmbeddingModel } from '../../src/core/types'

/**
 * Mock embedding model for testing.
 * Generates deterministic embeddings based on text content.
 */
export class MockEmbeddingModel implements EmbeddingModel {
  readonly dimensions = 768
  public callCount = 0
  public lastTexts: string[] = []

  async embed(text: string): Promise<Float32Array> {
    this.callCount++
    this.lastTexts.push(text)

    // Deterministic: hash text to consistent vector
    const hash = this.hashString(text)
    const vector = new Float32Array(this.dimensions)

    // Fill with deterministic values based on hash
    for (let i = 0; i < this.dimensions; i++) {
      vector[i] = ((hash + i) % 256) / 256
    }

    return vector
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    return Promise.all(texts.map(t => this.embed(t)))
  }

  private hashString(str: string): number {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i)
      hash = hash & hash // Convert to 32bit integer
    }
    return Math.abs(hash)
  }

  reset() {
    this.callCount = 0
    this.lastTexts = []
  }
}
