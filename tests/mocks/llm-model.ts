import { LLMModel } from '../../src/core/types'

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

  /**
   * Configure mock responses. Will cycle through these responses.
   * @param responses Array of JSON strings or text responses
   */
  setResponses(responses: string[]) {
    this.responses = responses
    this.responseIndex = 0
  }

  /**
   * Set a single response that will be repeated for all calls.
   */
  setResponse(response: string) {
    this.responses = [response]
    this.responseIndex = 0
  }

  /**
   * Configure to return empty learnings array.
   */
  setEmptyLearnings() {
    this.setResponse('[]')
  }

  /**
   * Configure to return invalid JSON (for error testing).
   */
  setInvalidJSON() {
    this.setResponse('this is not valid json')
  }

  async generateText(prompt: string, context?: string): Promise<string> {
    this.callCount++
    this.lastPrompts.push(prompt)
    this.lastContexts.push(context)

    if (this.responses.length === 0) {
      // Default: return empty learnings array
      return '[]'
    }

    // Get current response and advance index
    const response = this.responses[this.responseIndex]
    this.responseIndex = (this.responseIndex + 1) % this.responses.length

    return response
  }

  reset() {
    this.callCount = 0
    this.lastPrompts = []
    this.lastContexts = []
    this.responses = []
    this.responseIndex = 0
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
 * Helper function to create a valid learning JSON response.
 */
export function createMockLearningResponse(learnings: Array<{
  title: string
  content: string
  categories?: string[]
}>): string {
  return JSON.stringify(learnings)
}
