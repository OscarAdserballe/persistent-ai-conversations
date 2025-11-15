import { GoogleGenerativeAI } from '@google/generative-ai'
import { LLMModel } from '../core/types'

export interface GeminiFlashConfig {
  apiKey: string
  model?: string
  temperature?: number
  maxTokens?: number
  rateLimitDelayMs?: number
}

/**
 * Gemini Flash implementation for fast, cost-effective text generation.
 * Used for learning extraction (separate from embeddings).
 */
export class GeminiFlash implements LLMModel {
  readonly model: string
  private client: GoogleGenerativeAI
  private temperature: number
  private maxTokens: number
  private rateLimitDelayMs: number

  constructor(config: GeminiFlashConfig) {
    this.client = new GoogleGenerativeAI(config.apiKey)
    this.model = config.model || 'gemini-1.5-flash'
    this.temperature = config.temperature ?? 0.7
    this.maxTokens = config.maxTokens ?? 2000
    this.rateLimitDelayMs = config.rateLimitDelayMs ?? 1000
  }

  async generateText(prompt: string, context?: string): Promise<string> {
    const model = this.client.getGenerativeModel({
      model: this.model,
      generationConfig: {
        temperature: this.temperature,
        maxOutputTokens: this.maxTokens
      }
    })

    // Combine context and prompt
    const fullPrompt = context ? `${context}\n\n${prompt}` : prompt

    try {
      const result = await model.generateContent(fullPrompt)

      // Rate limiting between calls
      await this.delay(this.rateLimitDelayMs)

      const response = result.response
      return response.text()
    } catch (error) {
      throw new Error(`Gemini Flash generation failed: ${(error as Error).message}`)
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}
