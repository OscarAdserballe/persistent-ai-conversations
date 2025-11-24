import { describe, it, expect, beforeEach } from "vitest";
import { IsomorphismEngineImpl } from "../../server/services/isomorphism-engine.js";
import {
  MockLLMModel,
  createMockLearnings,
} from "../../src/mocks/index.js";
import type {
  LearningSearch,
  LearningSearchResult,
  LearningSearchOptions,
  Learning,
} from "../../src/core/types.js";

/**
 * Mock implementation of LearningSearch for testing
 */
class MockLearningSearch implements LearningSearch {
  private mockResults: LearningSearchResult[] = [];

  setResults(results: LearningSearchResult[]) {
    this.mockResults = results;
  }

  async search(
    query: string,
    options?: LearningSearchOptions
  ): Promise<LearningSearchResult[]> {
    const limit = options?.limit || 20;
    return this.mockResults.slice(0, limit);
  }
}

describe("IsomorphismEngine", () => {
  let engine: IsomorphismEngineImpl;
  let mockSearch: MockLearningSearch;
  let mockLLM: MockLLMModel;

  beforeEach(() => {
    mockSearch = new MockLearningSearch();
    mockLLM = new MockLLMModel();
    engine = new IsomorphismEngineImpl(mockSearch, mockLLM);
  });

  it("should retrieve relevant learnings and generate synthesis", async () => {
    // Setup: Create mock learnings with good similarity scores
    const mockLearnings = createMockLearnings([
      {
        title: "Redux Sagas for Async Flow Control",
        insight: "Redux Sagas use generator functions to handle async operations",
        abstraction: {
          concrete: "Redux Saga generators",
          pattern: "Channel-based async coordination",
          principle: "Isolation via message passing",
        },
      },
    ]);

    mockSearch.setResults([
      {
        learning: mockLearnings[0],
        score: 0.85,
        sourceConversation: {
          uuid: "conv-1",
          title: "Learning Redux",
          createdAt: new Date(),
        },
      },
    ]);

    // Set mock LLM response
    mockLLM.setResponse(
      "This is structurally similar to Redux Sagas which you learned about. Go channels are like Redux Sagas because both handle async streams through message passing."
    );

    // Act
    const result = await engine.explain("How do Go channels work?");

    // Assert
    expect(result.newConcept).toBe("How do Go channels work?");
    expect(result.relatedLearnings.length).toBeGreaterThan(0);
    expect(result.synthesis).toBeTruthy();
    expect(result.synthesis).toContain("Redux Sagas");
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.patterns).toContain("Channel-based async coordination");
    expect(result.timestamp).toBeInstanceOf(Date);
  });

  it("should handle no relevant learnings gracefully", async () => {
    // Setup: Empty search results
    mockSearch.setResults([]);

    // Act
    const result = await engine.explain("Completely novel concept");

    // Assert
    expect(result.relatedLearnings.length).toBe(0);
    expect(result.synthesis).toContain("No related learnings found");
    expect(result.confidence).toBe(0);
    expect(result.patterns.length).toBe(0);
  });

  it("should extract patterns from learnings", async () => {
    // Setup: Mock learnings with various patterns
    const mockLearnings = createMockLearnings([
      {
        title: "Learning 1",
        abstraction: {
          concrete: "Example 1",
          pattern: "Pattern A",
          principle: "Principle X",
        },
      },
      {
        title: "Learning 2",
        abstraction: {
          concrete: "Example 2",
          pattern: "Pattern B",
          principle: "Principle Y",
        },
      },
    ]);

    mockSearch.setResults([
      { learning: mockLearnings[0], score: 0.9 },
      { learning: mockLearnings[1], score: 0.8 },
    ]);

    mockLLM.setResponse("Test synthesis");

    // Act
    const result = await engine.explain("Test concept");

    // Assert
    expect(result.patterns).toContain("Pattern A");
    expect(result.patterns).toContain("Pattern B");
    expect(result.patterns).toContain("Principle X");
    expect(result.patterns).toContain("Principle Y");
    expect(result.patterns.length).toBe(4);
  });

  it("should calculate confidence based on similarity scores", async () => {
    // Setup: Learnings with varying similarity scores
    const mockLearnings = createMockLearnings([
      { title: "High similarity" },
      { title: "Medium similarity" },
      { title: "Low similarity" },
    ]);

    mockSearch.setResults([
      { learning: mockLearnings[0], score: 0.9 },
      { learning: mockLearnings[1], score: 0.7 },
      { learning: mockLearnings[2], score: 0.5 },
    ]);

    mockLLM.setResponse("Test synthesis");

    // Act
    const result = await engine.explain("Test concept");

    // Assert
    // Confidence = 0.9 * 0.6 + (0.9 + 0.7 + 0.5)/3 * 0.4
    // = 0.54 + 0.28 = 0.82 (approximately)
    expect(result.confidence).toBeGreaterThan(0.7);
    expect(result.confidence).toBeLessThan(0.9);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it("should respect learningLimit option", async () => {
    // Setup: Create many mock learnings
    const mockLearnings = createMockLearnings([
      { title: "Learning 1" },
      { title: "Learning 2" },
      { title: "Learning 3" },
      { title: "Learning 4" },
      { title: "Learning 5" },
      { title: "Learning 6" },
      { title: "Learning 7" },
      { title: "Learning 8" },
      { title: "Learning 9" },
      { title: "Learning 10" },
    ]);

    mockSearch.setResults(
      mockLearnings.map((learning, i) => ({
        learning,
        score: 0.9 - i * 0.05,
      }))
    );

    mockLLM.setResponse("Test synthesis");

    // Act
    const result = await engine.explain("Test concept", { learningLimit: 3 });

    // Assert
    expect(result.relatedLearnings.length).toBeLessThanOrEqual(3);
  });

  it("should build context with learning details", async () => {
    // Setup
    const mockLearnings = createMockLearnings([
      {
        title: "Test Learning",
        context: "Test context",
        insight: "Test insight",
        why: "Test why",
        abstraction: {
          concrete: "Concrete example",
          pattern: "Test pattern",
          principle: "Test principle",
        },
      },
    ]);

    mockSearch.setResults([
      {
        learning: mockLearnings[0],
        score: 0.8,
      },
    ]);

    // We need to capture what context was passed to LLM
    let capturedContext = "";
    mockLLM.setGenerateTextHandler((prompt, context) => {
      capturedContext = context || "";
      return "Test synthesis";
    });

    // Act
    await engine.explain("Test concept");

    // Assert - verify context includes learning details
    expect(capturedContext).toContain("Test context");
    expect(capturedContext).toContain("Test insight");
    expect(capturedContext).toContain("Test why");
    expect(capturedContext).toContain("Test pattern");
    expect(capturedContext).toContain("Test principle");
  });

  it("should default to 7 learnings if limit not specified", async () => {
    // Setup: Create 10 learnings
    const mockLearnings = createMockLearnings(
      Array(10)
        .fill(null)
        .map((_, i) => ({ title: `Learning ${i + 1}` }))
    );

    mockSearch.setResults(
      mockLearnings.map((learning, i) => ({
        learning,
        score: 0.9 - i * 0.05,
      }))
    );

    mockLLM.setResponse("Test synthesis");

    // Act - no learningLimit option provided
    const result = await engine.explain("Test concept");

    // Assert - should get exactly 7 learnings (the default)
    expect(result.relatedLearnings.length).toBe(7);
  });
});
