import { GoogleGenerativeAI } from '@google/generative-ai'
import pLimit from 'p-limit'
import { EmbeddingModel } from '../core/types'

export interface GeminiConfig {
  apiKey: string
  model?: string
  batchSize?: number
  rateLimitDelayMs?: number
  concurrency?: number
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
  private concurrency: number

  constructor(config: GeminiConfig) {
    this.client = new GoogleGenerativeAI(config.apiKey)
    this.model = config.model || 'text-embedding-004'
    this.batchSize = config.batchSize || 100
    this.rateLimitDelayMs = config.rateLimitDelayMs || 100
    this.concurrency = config.concurrency || 10
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
    // Use p-limit for parallel processing with controlled concurrency
    const limit = pLimit(this.concurrency)

    const tasks = texts.map((text, index) =>
      limit(async () => {
        const embedding = await this.embed(text)
        return { index, embedding }
      })
    )

    const results = await Promise.all(tasks)

    // Sort by original index to maintain order
    results.sort((a, b) => a.index - b.index)

    return results.map(r => r.embedding)
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}
