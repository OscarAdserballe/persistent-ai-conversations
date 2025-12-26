import { describe, it, expect, beforeEach, vi } from "vitest";
import { IsomorphismEngineImpl } from "../../server/services/isomorphism-engine.js";
import { createMockLearnings } from "../../src/mocks/index.js";
import type {
  LearningSearch,
  LearningSearchResult,
  LearningSearchOptions,
  Learning,
} from "../../src/core/types.js";
import { generateText, type LanguageModel } from "ai";

vi.mock("ai", () => ({
  generateText: vi.fn(),
}));

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

/**
 * Convert createMockLearnings output to Learning objects for test setup
 */
function toTestLearnings(
  mockLearnings: ReturnType<typeof createMockLearnings>
): Learning[] {
  return mockLearnings.map((m, i) => ({
    learningId: `learning-${i}`,
    title: m.title,
    problemSpace: m.problemSpace,
    insight: m.insight,
    blocks: m.blocks,
    sourceType: "conversation" as const,
    sourceId: `conv-${i}`,
    createdAt: new Date(),
  }));
}

describe("IsomorphismEngine", () => {
  let engine: IsomorphismEngineImpl;
  let mockSearch: MockLearningSearch;
  let model: LanguageModel;
  const generateTextMock = vi.mocked(generateText);

  beforeEach(() => {
    mockSearch = new MockLearningSearch();
    model = {} as LanguageModel;
    generateTextMock.mockReset();
    generateTextMock.mockResolvedValue({ text: "Test synthesis" });
    engine = new IsomorphismEngineImpl(mockSearch, model);
  });

  it("should retrieve relevant learnings and generate synthesis", async () => {
    // Setup: Create mock learnings with good similarity scores
    const mockLearnings = toTestLearnings(
      createMockLearnings([
        {
          title: "Redux Sagas for Async Flow Control",
          problemSpace: "Needed to handle complex async flows in React",
          insight:
            "Redux Sagas use generator functions to handle async operations through channel-based coordination",
          blocks: [
            { blockType: "why" as const, question: "Why use generators?", answer: "Generators allow pausing execution" },
            { blockType: "why" as const, question: "Why use channels?", answer: "Channels isolate side effects" },
            { blockType: "why" as const, question: "Why message passing?", answer: "Message passing prevents coupling" },
          ],
        },
      ])
    );

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
    generateTextMock.mockResolvedValueOnce({
      text: "This is structurally similar to Redux Sagas which you learned about. Go channels are like Redux Sagas because both handle async streams through message passing.",
    });

    // Act
    const result = await engine.explain("How do Go channels work?");

    // Assert
    expect(result.newConcept).toBe("How do Go channels work?");
    expect(result.relatedLearnings.length).toBeGreaterThan(0);
    expect(result.synthesis).toBeTruthy();
    expect(result.synthesis).toContain("Redux Sagas");
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.insights.length).toBeGreaterThan(0);
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
    expect(result.insights.length).toBe(0);
  });

  it("should extract insights from learnings", async () => {
    // Setup: Mock learnings with various insights
    const mockLearnings = toTestLearnings(
      createMockLearnings([
        {
          title: "Learning 1",
          insight: "First insight about patterns. More details here.",
        },
        {
          title: "Learning 2",
          insight: "Second insight about architecture. Additional context.",
        },
      ])
    );

    mockSearch.setResults([
      { learning: mockLearnings[0], score: 0.9 },
      { learning: mockLearnings[1], score: 0.8 },
    ]);

    generateTextMock.mockResolvedValueOnce({ text: "Test synthesis" });

    // Act
    const result = await engine.explain("Test concept");

    // Assert - insights are extracted from learning insights
    expect(result.insights.length).toBeGreaterThan(0);
    expect(result.insights.some((i) => i.includes("First insight"))).toBe(true);
    expect(result.insights.some((i) => i.includes("Second insight"))).toBe(
      true
    );
  });

  it("should calculate confidence based on similarity scores", async () => {
    // Setup: Learnings with varying similarity scores
    const mockLearnings = toTestLearnings(
      createMockLearnings([
        { title: "High similarity" },
        { title: "Medium similarity" },
        { title: "Low similarity" },
      ])
    );

    mockSearch.setResults([
      { learning: mockLearnings[0], score: 0.9 },
      { learning: mockLearnings[1], score: 0.7 },
      { learning: mockLearnings[2], score: 0.5 },
    ]);

    generateTextMock.mockResolvedValueOnce({ text: "Test synthesis" });

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
    const mockLearnings = toTestLearnings(
      createMockLearnings([
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
      ])
    );

    mockSearch.setResults(
      mockLearnings.map((learning, i) => ({
        learning,
        score: 0.9 - i * 0.05,
      }))
    );

    generateTextMock.mockResolvedValueOnce({ text: "Test synthesis" });

    // Act
    const result = await engine.explain("Test concept", { learningLimit: 3 });

    // Assert
    expect(result.relatedLearnings.length).toBeLessThanOrEqual(3);
  });

  it("should build context with learning details", async () => {
    // Setup
    const mockLearnings = toTestLearnings(
      createMockLearnings([
        {
          title: "Test Learning",
          problemSpace: "Test problem space for the learning",
          insight: "Test insight content",
          blocks: [
            { blockType: "why" as const, question: "Why reason 1?", answer: "Because of reason 1" },
            { blockType: "why" as const, question: "Why reason 2?", answer: "Because of reason 2" },
            { blockType: "qa" as const, question: "Test Q?", answer: "Test A" },
          ],
        },
      ])
    );

    mockSearch.setResults([
      {
        learning: mockLearnings[0],
        score: 0.8,
      },
    ]);

    generateTextMock.mockResolvedValueOnce({ text: "Test synthesis" });

    // Act
    await engine.explain("Test concept");

    // Assert - verify context includes learning details
    const lastCall = generateTextMock.mock.calls.at(-1)?.[0];
    expect(lastCall?.prompt).toContain("Test problem space for the learning");
    expect(lastCall?.prompt).toContain("Test insight content");
    expect(lastCall?.prompt).toContain("Why reason 1?");
    expect(lastCall?.prompt).toContain("Why reason 2?");
    expect(lastCall?.prompt).toContain("Test Q?");
    expect(lastCall?.prompt).toContain("Test A");
  });

  it("should default to 7 learnings if limit not specified", async () => {
    // Setup: Create 10 learnings
    const mockLearnings = toTestLearnings(
      createMockLearnings(
        Array(10)
          .fill(null)
          .map((_, i) => ({ title: `Learning ${i + 1}` }))
      )
    );

    mockSearch.setResults(
      mockLearnings.map((learning, i) => ({
        learning,
        score: 0.9 - i * 0.05,
      }))
    );

    generateTextMock.mockResolvedValueOnce({ text: "Test synthesis" });

    // Act - no learningLimit option provided
    const result = await engine.explain("Test concept");

    // Assert - should get exactly 7 learnings (the default)
    expect(result.relatedLearnings.length).toBe(7);
  });
});
