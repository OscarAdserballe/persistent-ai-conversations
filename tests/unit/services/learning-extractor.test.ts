import { describe, it, expect, beforeEach, vi } from "vitest";
import { generateObject } from "ai";
import { LearningExtractorImpl } from "../../../src/services/learning-extractor";
import { MockEmbeddingModel, createMockLearnings } from "../../../src/mocks";
import { ZodError } from "zod";
import {
  createDrizzleDb,
  getRawDb,
  type DrizzleDB,
} from "../../../src/db/client";

// Mock Vercel AI SDK generateObject so we can control LLM output
vi.mock("ai", () => ({
  generateObject: vi.fn(),
  // LearningExtractorImpl only needs the opaque model instance, not its methods
  LanguageModel: class {},
}));

describe("LearningExtractorImpl", () => {
  let extractor: LearningExtractorImpl;
  let embedder: MockEmbeddingModel;
  let drizzleDb: DrizzleDB;

  const mockConversation = {
    uuid: "conv-123",
    title: "Test Conversation",
    platform: "claude",
    messages: [
      {
        uuid: "msg-1",
        conversationUuid: "conv-123",
        conversationIndex: 0,
        sender: "human" as const,
        text: "What is TypeScript?",
        createdAt: new Date(),
        metadata: {},
      },
      {
        uuid: "msg-2",
        conversationUuid: "conv-123",
        conversationIndex: 1,
        sender: "assistant" as const,
        text: "TypeScript is a typed superset of JavaScript that compiles to plain JavaScript.",
        createdAt: new Date(),
        metadata: {},
      },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
    metadata: {},
  };

  const TEST_PROMPT = "Test prompt template";

  beforeEach(() => {
    // Create Drizzle-wrapped in-memory database
    drizzleDb = createDrizzleDb(":memory:");
    const rawDb = getRawDb(drizzleDb);

    // Create schema with new block-based Learning structure
    rawDb.exec(`
      CREATE TABLE learnings (
        learning_id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        problem_space TEXT NOT NULL,
        insight TEXT NOT NULL,
        blocks TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source_id TEXT NOT NULL,
        embedding BLOB NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE conversations (
        uuid TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        platform TEXT NOT NULL,
        message_count INTEGER NOT NULL
      );
    `);

    // Reset mocked generateObject
    const generateObjectMock = vi.mocked(generateObject);
    generateObjectMock.mockReset();

    // Default: LLM returns no learnings
    generateObjectMock.mockResolvedValue({ object: [] });

    // Create mocks
    embedder = new MockEmbeddingModel();

    // Create extractor with DrizzleDB
    extractor = new LearningExtractorImpl(
      {} as any,
      embedder,
      drizzleDb,
      TEST_PROMPT
    );
  });

  describe("extractFromConversation", () => {
    it("should extract learnings from conversation", async () => {
      // Configure LLM to return a valid learning with new schema
      const generateObjectMock = vi.mocked(generateObject);
      generateObjectMock.mockResolvedValueOnce({
        object: createMockLearnings([
          {
            title: "TypeScript Introduction",
            problemSpace: "Understanding TypeScript basics",
            insight: "TypeScript adds type safety to JavaScript",
          },
        ]),
      });

      const learnings = await extractor.extractFromConversation(
        mockConversation
      );

      expect(learnings).toHaveLength(1);
      expect(learnings[0].title).toBe("TypeScript Introduction");
      expect(learnings[0].problemSpace).toBe("Understanding TypeScript basics");
      expect(learnings[0].insight).toBe(
        "TypeScript adds type safety to JavaScript"
      );
      expect(learnings[0].sourceType).toBe("conversation");
      expect(learnings[0].sourceId).toBe("conv-123");
    });

    it("should return empty array when LLM returns empty", async () => {
      const generateObjectMock = vi.mocked(generateObject);
      generateObjectMock.mockResolvedValueOnce({ object: [] });

      const learnings = await extractor.extractFromConversation(
        mockConversation
      );

      expect(learnings).toEqual([]);
    });

    it("should throw ZodError when LLM returns invalid data", async () => {
      // Simulate Zod validation failure from generateObject
      const generateObjectMock = vi.mocked(generateObject);
      generateObjectMock.mockRejectedValueOnce(new ZodError([]));

      await expect(
        extractor.extractFromConversation(mockConversation)
      ).rejects.toThrow(ZodError);
    });

    it("should send conversation context to LLM", async () => {
      const generateObjectMock = vi.mocked(generateObject);
      generateObjectMock.mockResolvedValueOnce({ object: [] });

      await extractor.extractFromConversation(mockConversation);

      const lastCall = generateObjectMock.mock.calls.at(-1)?.[0];
      expect(lastCall).toBeDefined();
      const prompt = String(lastCall.prompt);
      expect(prompt).toContain("Test Conversation");
      expect(prompt).toContain("What is TypeScript?");
      expect(prompt).toContain("TypeScript is a typed superset");
    });

    it("should use the injected prompt template", async () => {
      const generateObjectMock = vi.mocked(generateObject);
      generateObjectMock.mockResolvedValueOnce({ object: [] });

      await extractor.extractFromConversation(mockConversation);

      const lastCall = generateObjectMock.mock.calls.at(-1)?.[0];
      const lastPrompt = String(lastCall.prompt);
      // Verify it's using the injected prompt
      expect(lastPrompt).toContain("Test prompt template");
    });

    it("should generate embeddings for learnings", async () => {
      const generateObjectMock = vi.mocked(generateObject);
      generateObjectMock.mockResolvedValueOnce({
        object: createMockLearnings([
          {
            title: "Test Learning",
          },
        ]),
      });

      await extractor.extractFromConversation(mockConversation);

      expect(embedder.callCount).toBeGreaterThan(0);
      // Batch embedding should combine all fields
      expect(embedder.lastTexts[0]).toContain("Test Learning");
      expect(embedder.lastTexts[0]).toContain("Test insight");
    });

    it("should store embeddings in database", async () => {
      const generateObjectMock = vi.mocked(generateObject);
      generateObjectMock.mockResolvedValueOnce({
        object: createMockLearnings([
          {
            title: "Test Learning",
          },
        ]),
      });

      await extractor.extractFromConversation(mockConversation);

      // Embeddings should be stored in database
      const learnings = getRawDb(drizzleDb)
        .prepare("SELECT learning_id, embedding FROM learnings")
        .all() as any[];
      expect(learnings.length).toBeGreaterThan(0);
      expect(learnings[0].embedding).toBeDefined();
      expect(learnings[0].embedding).not.toBeNull();
    });

    it("should store learnings in database", async () => {
      const generateObjectMock = vi.mocked(generateObject);
      generateObjectMock.mockResolvedValueOnce({
        object: createMockLearnings([
          {
            title: "Database Test",
          },
        ]),
      });

      await extractor.extractFromConversation(mockConversation);

      const stored = getRawDb(drizzleDb)
        .prepare("SELECT * FROM learnings")
        .all() as any[];
      expect(stored).toHaveLength(1);
      expect(stored[0].title).toBe("Database Test");
      // blocks should be JSON
      const blocks = JSON.parse(stored[0].blocks);
      expect(Array.isArray(blocks)).toBe(true);
    });

    it("should set sourceType and sourceId for conversation source", async () => {
      const generateObjectMock = vi.mocked(generateObject);
      generateObjectMock.mockResolvedValueOnce({
        object: createMockLearnings([
          {
            title: "Test",
          },
        ]),
      });

      await extractor.extractFromConversation(mockConversation);

      const stored = getRawDb(drizzleDb)
        .prepare("SELECT source_type, source_id FROM learnings")
        .all() as any[];
      expect(stored).toHaveLength(1);
      expect(stored[0].source_type).toBe("conversation");
      expect(stored[0].source_id).toBe("conv-123");
    });

    it("should generate UUID for learnings", async () => {
      const generateObjectMock = vi.mocked(generateObject);
      generateObjectMock.mockResolvedValueOnce({
        object: createMockLearnings([
          {
            title: "Test 1",
          },
          {
            title: "Test 2",
          },
        ]),
      });

      const learnings = await extractor.extractFromConversation(
        mockConversation
      );

      // Each learning should have unique UUID
      expect(learnings[0].learningId).toBeDefined();
      expect(learnings[1].learningId).toBeDefined();
      expect(learnings[0].learningId).not.toBe(learnings[1].learningId);
    });
  });

  describe("blocks management", () => {
    it("should handle multiple blocks per learning", async () => {
      const generateObjectMock = vi.mocked(generateObject);
      generateObjectMock.mockResolvedValueOnce({
        object: createMockLearnings([
          {
            title: "Test",
            blocks: [
              { blockType: "qa" as const, question: "Q1?", answer: "A1" },
              { blockType: "why" as const, question: "Why?", answer: "Because" },
              { blockType: "contrast" as const, question: "X vs Y?", answer: "Difference" },
            ],
          },
        ]),
      });

      const learnings = await extractor.extractFromConversation(
        mockConversation
      );

      expect(learnings[0].blocks).toHaveLength(3);
      expect(learnings[0].blocks[0].blockType).toBe("qa");
      expect(learnings[0].blocks[1].blockType).toBe("why");
      expect(learnings[0].blocks[2].blockType).toBe("contrast");
    });

    it("should store blocks as JSON in database", async () => {
      const generateObjectMock = vi.mocked(generateObject);
      generateObjectMock.mockResolvedValueOnce({
        object: createMockLearnings([
          {
            title: "Test",
            blocks: [
              { blockType: "qa" as const, question: "Test Q?", answer: "Test A" },
            ],
          },
        ]),
      });

      await extractor.extractFromConversation(mockConversation);

      const stored = getRawDb(drizzleDb)
        .prepare("SELECT blocks FROM learnings")
        .all() as any[];
      const blocks = JSON.parse(stored[0].blocks);
      expect(blocks).toHaveLength(1);
      expect(blocks[0].question).toBe("Test Q?");
    });

    it("should handle empty blocks array", async () => {
      const generateObjectMock = vi.mocked(generateObject);
      generateObjectMock.mockResolvedValueOnce({
        object: [
          {
            title: "Test",
            problemSpace: "Test problem",
            insight: "Test insight",
            blocks: [],
          },
        ],
      });

      const learnings = await extractor.extractFromConversation(
        mockConversation
      );

      expect(learnings[0].blocks).toEqual([]);
    });
  });

  describe("batch processing", () => {
    it("should batch embed multiple learnings", async () => {
      const generateObjectMock = vi.mocked(generateObject);
      generateObjectMock.mockResolvedValueOnce({
        object: createMockLearnings([
          { title: "Learning 1" },
          { title: "Learning 2" },
          { title: "Learning 3" },
        ]),
      });

      embedder.reset();
      await extractor.extractFromConversation(mockConversation);

      // embedBatch should be called once for all learnings
      expect(embedder.lastTexts.length).toBe(3);
    });

    it("should insert all learnings", async () => {
      const generateObjectMock = vi.mocked(generateObject);
      generateObjectMock.mockResolvedValueOnce({
        object: createMockLearnings([
          { title: "Learning 1" },
          { title: "Learning 2" },
        ]),
      });

      await extractor.extractFromConversation(mockConversation);

      // Both should be inserted
      const learnings = getRawDb(drizzleDb)
        .prepare("SELECT * FROM learnings")
        .all();
      expect(learnings).toHaveLength(2);
    });
  });

  describe("conversation context building", () => {
    it("should include conversation title", async () => {
      const generateObjectMock = vi.mocked(generateObject);
      generateObjectMock.mockResolvedValueOnce({ object: [] });

      await extractor.extractFromConversation(mockConversation);

      const lastCall = generateObjectMock.mock.calls.at(-1)?.[0];
      const context = String(lastCall.prompt);
      expect(context).toContain("Test Conversation");
    });

    it("should include conversation date", async () => {
      const generateObjectMock = vi.mocked(generateObject);
      generateObjectMock.mockResolvedValueOnce({ object: [] });

      await extractor.extractFromConversation(mockConversation);

      const lastCall = generateObjectMock.mock.calls.at(-1)?.[0];
      const context = String(lastCall.prompt);
      // Should have date in ISO format
      expect(context).toMatch(/\d{4}-\d{2}-\d{2}/);
    });

    it("should include all messages", async () => {
      const generateObjectMock = vi.mocked(generateObject);
      generateObjectMock.mockResolvedValueOnce({ object: [] });

      await extractor.extractFromConversation(mockConversation);

      const lastCall = generateObjectMock.mock.calls.at(-1)?.[0];
      const context = String(lastCall.prompt);
      expect(context).toContain("HUMAN");
      expect(context).toContain("ASSISTANT");
      expect(context).toContain("What is TypeScript?");
      expect(context).toContain("TypeScript is a typed superset");
    });

    it("should format messages with sender labels", async () => {
      const generateObjectMock = vi.mocked(generateObject);
      generateObjectMock.mockResolvedValueOnce({ object: [] });

      await extractor.extractFromConversation(mockConversation);

      const lastCall = generateObjectMock.mock.calls.at(-1)?.[0];
      const context = String(lastCall.prompt);
      expect(context).toContain("[HUMAN]:");
      expect(context).toContain("[ASSISTANT]:");
    });
  });

  describe("error handling", () => {
    it("should throw ZodError for invalid structured output", async () => {
      // Simulate Zod validation failure
      const generateObjectMock = vi.mocked(generateObject);
      generateObjectMock.mockRejectedValueOnce(new ZodError([]));

      await expect(
        extractor.extractFromConversation(mockConversation)
      ).rejects.toThrow(ZodError);
    });

    it("should work with valid data from embedder", async () => {
      const generateObjectMock = vi.mocked(generateObject);
      generateObjectMock.mockResolvedValueOnce({
        object: createMockLearnings([{ title: "Good" }]),
      });

      // This should still work with mock embedder
      await expect(
        extractor.extractFromConversation(mockConversation)
      ).resolves.toBeDefined();
    });
  });

  describe("empty and edge cases", () => {
    it("should handle conversation with no messages", async () => {
      const emptyConv = { ...mockConversation, messages: [] };

      const generateObjectMock = vi.mocked(generateObject);
      generateObjectMock.mockResolvedValueOnce({ object: [] });

      await expect(
        extractor.extractFromConversation(emptyConv)
      ).resolves.toEqual([]);
    });

    it("should handle very long conversations", async () => {
      const longConv = {
        ...mockConversation,
        messages: Array(100)
          .fill(null)
          .map((_, i) => ({
            uuid: `msg-${i}`,
            conversationUuid: "conv-123",
            conversationIndex: i,
            sender: (i % 2 === 0 ? "human" : "assistant") as const,
            text: `Message ${i}`,
            createdAt: new Date(),
            metadata: {},
          })),
      };

      const generateObjectMock = vi.mocked(generateObject);
      generateObjectMock.mockResolvedValueOnce({ object: [] });

      await expect(
        extractor.extractFromConversation(longConv)
      ).resolves.toEqual([]);
    });

    it("should handle learnings with long titles", async () => {
      const longTitle = "A".repeat(100);

      const generateObjectMock = vi.mocked(generateObject);
      generateObjectMock.mockResolvedValueOnce({
        object: createMockLearnings([{ title: longTitle }]),
      });

      const learnings = await extractor.extractFromConversation(
        mockConversation
      );

      expect(learnings[0].title).toBe(longTitle);
      expect(learnings[0].title.length).toBe(100);
    });

    it("should handle learnings with very long insight", async () => {
      const longInsight = "B".repeat(5000);

      const generateObjectMock = vi.mocked(generateObject);
      generateObjectMock.mockResolvedValueOnce({
        object: createMockLearnings([{ title: "Title", insight: longInsight }]),
      });

      const learnings = await extractor.extractFromConversation(
        mockConversation
      );

      expect(learnings[0].insight).toBe(longInsight);
    });

    it("should handle many blocks per learning", async () => {
      const manyBlocks = Array(20)
        .fill(null)
        .map((_, i) => ({
          blockType: "qa" as const,
          question: `Q${i}?`,
          answer: `A${i}`,
        }));

      const generateObjectMock = vi.mocked(generateObject);
      generateObjectMock.mockResolvedValueOnce({
        object: [
          {
            title: "Test",
            problemSpace: "Test problem",
            insight: "Test insight",
            blocks: manyBlocks,
          },
        ],
      });

      const learnings = await extractor.extractFromConversation(
        mockConversation
      );

      expect(learnings[0].blocks).toHaveLength(20);
    });
  });
});
