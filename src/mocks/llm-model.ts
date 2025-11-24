import { LLMModel } from '../core/types'

/**
 * Mock LLM model for testing.
 * Allows configuring responses for predictable testing.
 */
export class MockLLMModel implements LLMModel {
  readonly model = 'mock-llm'
  public callCount = 0
  public lastPrompts: string[] = []
  public lastContexts: (string | undefined)[] = []

  private responses: string[] = []
  private responseIndex = 0
  private structuredResponses: any[] = []
  private structuredResponseIndex = 0
  private generateTextHandler?: (prompt: string, context?: string) => string

  /**
   * Configure mock responses for generateText. Will cycle through these responses.
   * @param responses Array of JSON strings or text responses
   */
  setResponses(responses: string[]) {
    this.responses = responses
    this.responseIndex = 0
  }

  /**
   * Set a single response that will be repeated for all generateText calls.
   */
  setResponse(response: string) {
    this.responses = [response]
    this.responseIndex = 0
  }

  /**
   * Configure structured responses for generateStructuredOutput.
   * @param responses Array of objects to return
   */
  setStructuredResponses(responses: any[]) {
    this.structuredResponses = responses
    this.structuredResponseIndex = 0
  }

  /**
   * Set a single structured response for generateStructuredOutput.
   */
  setStructuredResponse(response: any) {
    this.structuredResponses = [response]
    this.structuredResponseIndex = 0
  }

  /**
   * Configure to return empty learnings array.
   */
  setEmptyLearnings() {
    this.setStructuredResponse([])
  }

  /**
   * Set a custom handler for generateText calls.
   * Useful for capturing context or providing dynamic responses.
   */
  setGenerateTextHandler(handler: (prompt: string, context?: string) => string) {
    this.generateTextHandler = handler
  }

  async generateText(prompt: string, context?: string): Promise<string> {
    this.callCount++
    this.lastPrompts.push(prompt)
    this.lastContexts.push(context)

    // If handler is set, use it
    if (this.generateTextHandler) {
      return this.generateTextHandler(prompt, context)
    }

    if (this.responses.length === 0) {
      // Default: return empty learnings array
      return '[]'
    }

    // Get current response and advance index
    const response = this.responses[this.responseIndex]
    this.responseIndex = (this.responseIndex + 1) % this.responses.length

    return response
  }

  async generateStructuredOutput<T>(
    prompt: string,
    context: string | undefined,
    _responseSchema: any
  ): Promise<T> {
    this.callCount++
    this.lastPrompts.push(prompt)
    this.lastContexts.push(context)

    if (this.structuredResponses.length === 0) {
      // Default: return empty array
      return [] as T
    }

    // Get current response and advance index
    const response = this.structuredResponses[this.structuredResponseIndex]
    this.structuredResponseIndex = (this.structuredResponseIndex + 1) % this.structuredResponses.length

    return response as T
  }

  reset() {
    this.callCount = 0
    this.lastPrompts = []
    this.lastContexts = []
    this.responses = []
    this.responseIndex = 0
    this.structuredResponses = []
    this.structuredResponseIndex = 0
    this.generateTextHandler = undefined
  }

  /**
   * Helper to get the last prompt that was sent.
   */
  getLastPrompt(): string | undefined {
    return this.lastPrompts[this.lastPrompts.length - 1]
  }

  /**
   * Helper to get the last context that was sent.
   */
  getLastContext(): string | undefined {
    return this.lastContexts[this.lastContexts.length - 1]
  }
}

/**
 * Helper function to create a valid learning JSON response string (for old generateText tests).
 * @deprecated Use createMockLearnings for structured output instead
 */
export function createMockLearningResponse(learnings: Array<{
  title: string
  context?: string
  insight?: string
  why?: string
  implications?: string
  tags?: string[]
  abstraction?: {
    concrete: string
    pattern: string
    principle?: string
  }
  understanding?: {
    confidence: number
    can_teach_it: boolean
    known_gaps?: string[]
  }
  effort?: {
    processing_time: string
    cognitive_load: string
  }
  resonance?: {
    intensity: number
    valence: string
  }
  learning_type?: string
  source_credit?: string
}>): string {
  const mapped = createMockLearnings(learnings)
  return JSON.stringify(mapped)
}

/**
 * Helper function to create valid learning objects for structured output.
 */
export function createMockLearnings(learnings: Array<{
  title: string
  context?: string
  insight?: string
  why?: string
  implications?: string
  tags?: string[]
  abstraction?: {
    concrete: string
    pattern: string
    principle?: string
  }
  understanding?: {
    confidence: number
    can_teach_it: boolean
    known_gaps?: string[]
  }
  effort?: {
    processing_time: string
    cognitive_load: string
  }
  resonance?: {
    intensity: number
    valence: string
  }
  learning_type?: string
  source_credit?: string
}>) {
  // Map to new schema format, providing defaults where needed
  return learnings.map(l => ({
    title: l.title,
    context: l.context || 'Test context',
    insight: l.insight || 'Test insight',
    why: l.why || 'Test explanation',
    implications: l.implications || 'Test implications',
    tags: l.tags || ['test'],
    abstraction: l.abstraction || {
      concrete: 'Test concrete example',
      pattern: 'Test pattern',
      principle: 'Test principle'
    },
    understanding: l.understanding || {
      confidence: 7,
      can_teach_it: true,
      known_gaps: []
    },
    effort: l.effort || {
      processing_time: '30min',
      cognitive_load: 'moderate'
    },
    resonance: l.resonance || {
      intensity: 5,
      valence: 'positive'
    },
    learning_type: l.learning_type,
    source_credit: l.source_credit
  }))
}
