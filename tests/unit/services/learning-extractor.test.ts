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

    // Create minimal schema for tests (simplified Learning Artifact schema)
    rawDb.exec(`
      CREATE TABLE learnings (
        learning_id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        trigger TEXT NOT NULL,
        insight TEXT NOT NULL,
        why_points TEXT NOT NULL,
        faq TEXT NOT NULL,
        conversation_uuid TEXT,
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
      // Configure LLM to return a valid learning with simplified schema
      const generateObjectMock = vi.mocked(generateObject);
      generateObjectMock.mockResolvedValueOnce({
        object: createMockLearnings([
          {
            title: "TypeScript Introduction",
            trigger: "Understanding TypeScript basics",
            insight: "TypeScript adds type safety to JavaScript",
          },
        ]),
      });

      const learnings = await extractor.extractFromConversation(
        mockConversation
      );

      expect(learnings).toHaveLength(1);
      expect(learnings[0].title).toBe("TypeScript Introduction");
      expect(learnings[0].trigger).toBe("Understanding TypeScript basics");
      expect(learnings[0].insight).toBe(
        "TypeScript adds type safety to JavaScript"
      );
      expect(learnings[0].conversationUuid).toBe("conv-123");
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
      // why_points should be JSON
      const whyPoints = JSON.parse(stored[0].why_points);
      expect(Array.isArray(whyPoints)).toBe(true);
    });

    it("should link learnings to source conversation", async () => {
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
        .prepare("SELECT conversation_uuid FROM learnings")
        .all() as any[];
      expect(stored).toHaveLength(1);
      expect(stored[0].conversation_uuid).toBe("conv-123");
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

  describe("why_points and faq management", () => {
    it("should handle multiple why_points per learning", async () => {
      const generateObjectMock = vi.mocked(generateObject);
      generateObjectMock.mockResolvedValueOnce({
        object: createMockLearnings([
          {
            title: "Test",
            why_points: ["reason1", "reason2", "reason3"],
          },
        ]),
      });

      const learnings = await extractor.extractFromConversation(
        mockConversation
      );

      expect(learnings[0].whyPoints).toHaveLength(3);
      expect(learnings[0].whyPoints).toContain("reason1");
      expect(learnings[0].whyPoints).toContain("reason2");
      expect(learnings[0].whyPoints).toContain("reason3");
    });

    it("should handle multiple faq items per learning", async () => {
      const generateObjectMock = vi.mocked(generateObject);
      generateObjectMock.mockResolvedValueOnce({
        object: createMockLearnings([
          {
            title: "Test",
            faq: [
              { question: "Q1?", answer: "A1" },
              { question: "Q2?", answer: "A2" },
            ],
          },
        ]),
      });

      const learnings = await extractor.extractFromConversation(
        mockConversation
      );

      expect(learnings[0].faq).toHaveLength(2);
      expect(learnings[0].faq[0].question).toBe("Q1?");
      expect(learnings[0].faq[0].answer).toBe("A1");
    });

    it("should store why_points as JSON in database", async () => {
      const generateObjectMock = vi.mocked(generateObject);
      generateObjectMock.mockResolvedValueOnce({
        object: createMockLearnings([
          {
            title: "Test",
            why_points: ["test-reason"],
          },
        ]),
      });

      await extractor.extractFromConversation(mockConversation);

      const stored = getRawDb(drizzleDb)
        .prepare("SELECT why_points FROM learnings")
        .all() as any[];
      const whyPoints = JSON.parse(stored[0].why_points);
      expect(whyPoints).toContain("test-reason");
    });

    it("should store faq as JSON in database", async () => {
      const generateObjectMock = vi.mocked(generateObject);
      generateObjectMock.mockResolvedValueOnce({
        object: createMockLearnings([
          {
            title: "Test",
            faq: [{ question: "Q?", answer: "A" }],
          },
        ]),
      });

      await extractor.extractFromConversation(mockConversation);

      const stored = getRawDb(drizzleDb)
        .prepare("SELECT faq FROM learnings")
        .all() as any[];
      const faq = JSON.parse(stored[0].faq);
      expect(faq).toHaveLength(1);
      expect(faq[0].question).toBe("Q?");
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

    it("should handle many why_points per learning", async () => {
      const manyReasons = Array(20)
        .fill(null)
        .map((_, i) => `reason-${i}`);

      const generateObjectMock = vi.mocked(generateObject);
      generateObjectMock.mockResolvedValueOnce({
        object: createMockLearnings([
          { title: "Test", why_points: manyReasons },
        ]),
      });

      const learnings = await extractor.extractFromConversation(
        mockConversation
      );

      expect(learnings[0].whyPoints).toHaveLength(20);
    });
  });
});
