import { describe, it, expect, beforeEach, vi } from 'vitest'
import { GeminiEmbedding } from '../../../src/embeddings/gemini'

// Mock the Gemini API
vi.mock('@google/generative-ai', () => {
  return {
    GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
      getGenerativeModel: vi.fn().mockReturnValue({
        embedContent: vi.fn().mockImplementation(async (text: string) => ({
          embedding: {
            values: new Array(768).fill(0.5)
          }
        }))
      })
    }))
  }
})

describe('GeminiEmbedding', () => {
  let embedder: GeminiEmbedding

  beforeEach(() => {
    embedder = new GeminiEmbedding({
      apiKey: 'test-key',
      rateLimitDelayMs: 0 // Disable delay for tests
    })
  })

  describe('constructor', () => {
    it('should initialize with default model', () => {
      expect(embedder.model).toBe('text-embedding-004')
    })

    it('should use custom model if provided', () => {
      const customEmbedder = new GeminiEmbedding({
        apiKey: 'test-key',
        model: 'custom-model'
      })
      expect(customEmbedder.model).toBe('custom-model')
    })

    it('should have 768 dimensions', () => {
      expect(embedder.dimensions).toBe(768)
    })
  })

  describe('embed', () => {
    it('should return Float32Array', async () => {
      const result = await embedder.embed('test text')
      expect(result).toBeInstanceOf(Float32Array)
    })

    it('should return array with correct dimensions', async () => {
      const result = await embedder.embed('test text')
      expect(result.length).toBe(768)
    })

    it('should handle empty string', async () => {
      const result = await embedder.embed('')
      expect(result).toBeInstanceOf(Float32Array)
      expect(result.length).toBe(768)
    })

    it('should handle long text', async () => {
      const longText = 'word '.repeat(1000)
      const result = await embedder.embed(longText)
      expect(result).toBeInstanceOf(Float32Array)
      expect(result.length).toBe(768)
    })
  })

  describe('embedBatch', () => {
    it('should return array of embeddings', async () => {
      const texts = ['text1', 'text2', 'text3']
      const results = await embedder.embedBatch(texts)

      expect(results).toHaveLength(3)
      expect(results[0]).toBeInstanceOf(Float32Array)
      expect(results[1]).toBeInstanceOf(Float32Array)
      expect(results[2]).toBeInstanceOf(Float32Array)
    })

    it('should handle empty array', async () => {
      const results = await embedder.embedBatch([])
      expect(results).toHaveLength(0)
    })

    it('should handle single item', async () => {
      const results = await embedder.embedBatch(['single'])
      expect(results).toHaveLength(1)
      expect(results[0].length).toBe(768)
    })

    it('should handle batches larger than batch size', async () => {
      const texts = Array(10).fill('test') // Smaller for test speed
      const results = await embedder.embedBatch(texts)

      expect(results).toHaveLength(10)
      results.forEach(result => {
        expect(result.length).toBe(768)
      })
    })

    it('should respect batch size configuration', async () => {
      const customEmbedder = new GeminiEmbedding({
        apiKey: 'test-key',
        batchSize: 5,
        rateLimitDelayMs: 0
      })

      const texts = Array(7).fill('test') // 7 items with batch size 5
      const results = await customEmbedder.embedBatch(texts)

      expect(results).toHaveLength(7)
    })
  })
})
