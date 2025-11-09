import { GoogleGenerativeAI } from '@google/generative-ai'
import { EmbeddingModel } from '../core/types'

export interface GeminiConfig {
  apiKey: string
  model?: string
  batchSize?: number
  rateLimitDelayMs?: number
}

/**
 * Gemini API implementation of EmbeddingModel.
 * Uses text-embedding-004 model with 768 dimensions.
 */
export class GeminiEmbedding implements EmbeddingModel {
  readonly dimensions = 768
  readonly model: string
  private client: GoogleGenerativeAI
  private batchSize: number
  private rateLimitDelayMs: number

  constructor(config: GeminiConfig) {
    this.client = new GoogleGenerativeAI(config.apiKey)
    this.model = config.model || 'text-embedding-004'
    this.batchSize = config.batchSize || 100
    this.rateLimitDelayMs = config.rateLimitDelayMs || 100
  }

  async embed(text: string): Promise<Float32Array> {
    try {
      const model = this.client.getGenerativeModel({ model: this.model })
      const result = await model.embedContent(text)

      if (!result.embedding || !result.embedding.values) {
        throw new Error('Invalid embedding response from Gemini API')
      }

      return new Float32Array(result.embedding.values)
    } catch (error) {
      throw new Error(`Failed to generate embedding: ${(error as Error).message}`)
    }
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    const embeddings: Float32Array[] = []

    // Process in batches to respect rate limits
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize)

      // Process batch sequentially with delay
      for (const text of batch) {
        const embedding = await this.embed(text)
        embeddings.push(embedding)

        // Rate limit delay between requests
        if (this.rateLimitDelayMs > 0) {
          await this.sleep(this.rateLimitDelayMs)
        }
      }
    }

    return embeddings
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}
