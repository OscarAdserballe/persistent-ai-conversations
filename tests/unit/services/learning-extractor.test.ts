import { describe, it, expect, beforeEach, vi } from "vitest";
import { LearningExtractorImpl } from "../../../src/services/learning-extractor";
import {
  MockLLMModel,
  MockEmbeddingModel,
  MockVectorStore,
  createMockLearnings,
} from '../../../src/mocks';
import { ZodError } from "zod";
import { createDrizzleDb, getRawDb, type DrizzleDB } from "../../../src/db/client";

describe("LearningExtractorImpl", () => {
  let extractor: LearningExtractorImpl;
  let llm: MockLLMModel;
  let embedder: MockEmbeddingModel;
  let vectorStore: MockVectorStore;
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

  beforeEach(() => {
    // Create Drizzle-wrapped in-memory database
    // Note: NOT calling initializeSchema - would need to use factory's createDatabase for that
    // For unit tests, manually create minimal schema
    drizzleDb = createDrizzleDb(":memory:");
    const rawDb = getRawDb(drizzleDb);

    // Create minimal schema for tests (just what we need)
    rawDb.exec(`
      CREATE TABLE learnings (
        learning_id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        context TEXT NOT NULL,
        insight TEXT NOT NULL,
        why TEXT NOT NULL,
        implications TEXT NOT NULL,
        tags TEXT NOT NULL,
        abstraction TEXT NOT NULL,
        understanding TEXT NOT NULL,
        effort TEXT NOT NULL,
        resonance TEXT NOT NULL,
        learning_type TEXT,
        source_credit TEXT,
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

    // Create mocks
    llm = new MockLLMModel();
    embedder = new MockEmbeddingModel();
    vectorStore = new MockVectorStore();
    vectorStore.initialize(768);

    // Create extractor with DrizzleDB (uses type-safe queries now)
    extractor = new LearningExtractorImpl(llm, embedder, drizzleDb);
  });

  describe("extractFromConversation", () => {
    it("should extract learnings from conversation", async () => {
      // Configure LLM to return a valid learning with new schema
      llm.setStructuredResponse(
        createMockLearnings([
          {
            title: "TypeScript Introduction",
            tags: ["programming", "typescript"],
          },
        ])
      );

      const learnings = await extractor.extractFromConversation(
        mockConversation
      );

      expect(learnings).toHaveLength(1);
      expect(learnings[0].title).toBe("TypeScript Introduction");
      expect(learnings[0].tags).toHaveLength(2);
      expect(learnings[0].abstraction.concrete).toBe("Test concrete example");
      expect(learnings[0].conversationUuid).toBe("conv-123");
    });

    it("should return empty array when LLM returns empty", async () => {
      llm.setEmptyLearnings();

      const learnings = await extractor.extractFromConversation(
        mockConversation
      );

      expect(learnings).toEqual([]);
    });

    it("should throw ZodError when LLM returns invalid data", async () => {
      // Structured output returns object, but it doesn't match schema
      llm.setStructuredResponse({ title: "Not an array" });

      await expect(
        extractor.extractFromConversation(mockConversation)
      ).rejects.toThrow(ZodError);
    });

    it("should throw ZodError when required fields are missing", async () => {
      // Missing required fields like 'why', 'implications', etc.
      llm.setStructuredResponse([{ title: "Incomplete" }]);

      await expect(
        extractor.extractFromConversation(mockConversation)
      ).rejects.toThrow(ZodError);
    });

    it("should send conversation context to LLM", async () => {
      llm.setEmptyLearnings();

      await extractor.extractFromConversation(mockConversation);

      const lastContext = llm.getLastContext();
      expect(lastContext).toContain("Test Conversation");
      expect(lastContext).toContain("What is TypeScript?");
      expect(lastContext).toContain("TypeScript is a typed superset");
    });

    it("should send advanced prompt to LLM", async () => {
      llm.setEmptyLearnings();

      await extractor.extractFromConversation(mockConversation);

      const lastPrompt = llm.getLastPrompt();
      // Verify it's using the new advanced prompt
      expect(lastPrompt).toContain("Abstraction Ladder");
      expect(lastPrompt).toContain("Understanding Assessment");
      expect(lastPrompt).toContain("Effort Tracking");
    });

    it("should generate embeddings for learnings", async () => {
      llm.setStructuredResponse(
        createMockLearnings([
          {
            title: "Test Learning",
            tags: ["test"],
          },
        ])
      );

      await extractor.extractFromConversation(mockConversation);

      expect(embedder.callCount).toBeGreaterThan(0);
      // Batch embedding should combine all fields
      expect(embedder.lastTexts[0]).toContain("Test Learning");
      expect(embedder.lastTexts[0]).toContain("Test insight");
    });

    it("should store embeddings in database", async () => {
      llm.setStructuredResponse(
        createMockLearnings([
          {
            title: "Test Learning",
            tags: ["test"],
          },
        ])
      );

      await extractor.extractFromConversation(mockConversation);

      // Embeddings should be stored in database, not vector store
      const learnings = getRawDb(drizzleDb)
        .prepare("SELECT learning_id, embedding FROM learnings")
        .all() as any[];
      expect(learnings.length).toBeGreaterThan(0);
      expect(learnings[0].embedding).toBeDefined();
      expect(learnings[0].embedding).not.toBeNull();
    });

    it("should store learnings in database", async () => {
      llm.setStructuredResponse(
        createMockLearnings([
          {
            title: "Database Test",
            tags: ["test"],
          },
        ])
      );

      await extractor.extractFromConversation(mockConversation);

      const stored = getRawDb(drizzleDb).prepare("SELECT * FROM learnings").all() as any[];
      expect(stored).toHaveLength(1);
      expect(stored[0].title).toBe("Database Test");
      // Tags should be JSON
      const tags = JSON.parse(stored[0].tags);
      expect(tags).toContain("test");
    });

    it("should link learnings to source conversation", async () => {
      llm.setStructuredResponse(
        createMockLearnings([
          {
            title: "Test",
            tags: [],
          },
        ])
      );

      await extractor.extractFromConversation(mockConversation);

      const stored = getRawDb(drizzleDb)
        .prepare("SELECT conversation_uuid FROM learnings")
        .all() as any[];
      expect(stored).toHaveLength(1);
      expect(stored[0].conversation_uuid).toBe("conv-123");
    });

    it("should generate UUID for learnings", async () => {
      llm.setStructuredResponse(
        createMockLearnings([
          {
            title: "Test 1",
            tags: [],
          },
          {
            title: "Test 2",
            tags: [],
          },
        ])
      );

      const learnings = await extractor.extractFromConversation(
        mockConversation
      );

      // Each learning should have unique UUID
      expect(learnings[0].learningId).toBeDefined();
      expect(learnings[1].learningId).toBeDefined();
      expect(learnings[0].learningId).not.toBe(learnings[1].learningId);
    });
  });

  describe("tag management", () => {
    it("should handle multiple tags per learning", async () => {
      llm.setStructuredResponse(
        createMockLearnings([
          {
            title: "Test",
            tags: ["tag1", "tag2", "tag3"],
          },
        ])
      );

      const learnings = await extractor.extractFromConversation(
        mockConversation
      );

      expect(learnings[0].tags).toHaveLength(3);
      expect(learnings[0].tags).toContain("tag1");
      expect(learnings[0].tags).toContain("tag2");
      expect(learnings[0].tags).toContain("tag3");
    });

    it("should handle learnings without tags", async () => {
      llm.setStructuredResponse(
        createMockLearnings([
          {
            title: "Test",
            tags: [],
          },
        ])
      );

      const learnings = await extractor.extractFromConversation(
        mockConversation
      );

      expect(learnings[0].tags).toEqual([]);
    });

    it("should store tags as JSON in database", async () => {
      llm.setStructuredResponse(
        createMockLearnings([
          {
            title: "Test",
            tags: ["test-tag"],
          },
        ])
      );

      await extractor.extractFromConversation(mockConversation);

      const stored = getRawDb(drizzleDb).prepare("SELECT tags FROM learnings").all() as any[];
      const tags = JSON.parse(stored[0].tags);
      expect(tags).toContain("test-tag");
    });
  });

  describe("batch processing", () => {
    it("should batch embed multiple learnings", async () => {
      llm.setStructuredResponse(
        createMockLearnings([
          { title: "Learning 1", tags: [] },
          { title: "Learning 2", tags: [] },
          { title: "Learning 3", tags: [] },
        ])
      );

      embedder.reset();
      await extractor.extractFromConversation(mockConversation);

      // embedBatch should be called once for all learnings
      expect(embedder.lastTexts.length).toBe(3);
    });

    it("should use transaction for atomic insertion", async () => {
      llm.setStructuredResponse(
        createMockLearnings([
          { title: "Learning 1", tags: [] },
          { title: "Learning 2", tags: [] },
        ])
      );

      await extractor.extractFromConversation(mockConversation);

      // Both should be inserted or neither (transaction)
      const learnings = getRawDb(drizzleDb).prepare("SELECT * FROM learnings").all();
      expect(learnings).toHaveLength(2);
    });
  });

  describe("conversation context building", () => {
    it("should include conversation title", async () => {
      llm.setEmptyLearnings();

      await extractor.extractFromConversation(mockConversation);

      const context = llm.getLastContext();
      expect(context).toContain("Test Conversation");
    });

    it("should include conversation date", async () => {
      llm.setEmptyLearnings();

      await extractor.extractFromConversation(mockConversation);

      const context = llm.getLastContext();
      // Should have date in ISO format
      expect(context).toMatch(/\d{4}-\d{2}-\d{2}/);
    });

    it("should include all messages", async () => {
      llm.setEmptyLearnings();

      await extractor.extractFromConversation(mockConversation);

      const context = llm.getLastContext();
      expect(context).toContain("HUMAN");
      expect(context).toContain("ASSISTANT");
      expect(context).toContain("What is TypeScript?");
      expect(context).toContain("TypeScript is a typed superset");
    });

    it("should format messages with sender labels", async () => {
      llm.setEmptyLearnings();

      await extractor.extractFromConversation(mockConversation);

      const context = llm.getLastContext();
      expect(context).toContain("[HUMAN]:");
      expect(context).toContain("[ASSISTANT]:");
    });
  });

  describe("error handling", () => {
    it("should throw ZodError for invalid structured output", async () => {
      // With structured output, Gemini enforces JSON but Zod validates schema
      llm.setStructuredResponse([{ invalid: "schema" }]);

      await expect(
        extractor.extractFromConversation(mockConversation)
      ).rejects.toThrow(ZodError);
    });

    it("should throw ZodError when confidence is out of range", async () => {
      llm.setStructuredResponse(
        createMockLearnings([
          {
            title: "Test",
            understanding: {
              confidence: 15, // Invalid: > 10
              can_teach_it: true,
            },
          },
        ])
      );

      await expect(
        extractor.extractFromConversation(mockConversation)
      ).rejects.toThrow(ZodError);
    });

    it("should throw ZodError for invalid enum values", async () => {
      llm.setStructuredResponse(
        createMockLearnings([
          {
            title: "Test",
            effort: {
              processing_time: "invalid", // Not in enum
              cognitive_load: "easy",
            },
          },
        ])
      );

      await expect(
        extractor.extractFromConversation(mockConversation)
      ).rejects.toThrow(ZodError);
    });

    it("should work with valid data from embedder", async () => {
      llm.setStructuredResponse(
        createMockLearnings([{ title: "Good", tags: [] }])
      );

      // This should still work with mock embedder
      await expect(
        extractor.extractFromConversation(mockConversation)
      ).resolves.toBeDefined();
    });
  });

  describe("empty and edge cases", () => {
    it("should handle conversation with no messages", async () => {
      const emptyConv = { ...mockConversation, messages: [] };

      llm.setEmptyLearnings();

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

      llm.setEmptyLearnings();

      await expect(
        extractor.extractFromConversation(longConv)
      ).resolves.toEqual([]);
    });

    it("should handle learnings with long titles up to 100 chars", async () => {
      const longTitle = "A".repeat(100); // Max allowed by schema

      llm.setStructuredResponse(
        createMockLearnings([{ title: longTitle, tags: [] }])
      );

      const learnings = await extractor.extractFromConversation(
        mockConversation
      );

      expect(learnings[0].title).toBe(longTitle);
      expect(learnings[0].title.length).toBe(100);
    });

    it("should throw ZodError for titles over 100 chars", async () => {
      const tooLongTitle = "A".repeat(101); // Over the limit

      llm.setStructuredResponse(
        createMockLearnings([{ title: tooLongTitle, tags: [] }])
      );

      await expect(
        extractor.extractFromConversation(mockConversation)
      ).rejects.toThrow(ZodError);
    });

    it("should handle learnings with very long insight", async () => {
      const longInsight = "B".repeat(5000);

      llm.setStructuredResponse(
        createMockLearnings([
          { title: "Title", insight: longInsight, tags: [] },
        ])
      );

      const learnings = await extractor.extractFromConversation(
        mockConversation
      );

      expect(learnings[0].insight).toBe(longInsight);
    });

    it("should handle many tags per learning", async () => {
      const manyTags = Array(20)
        .fill(null)
        .map((_, i) => `tag-${i}`);

      llm.setStructuredResponse(
        createMockLearnings([{ title: "Test", tags: manyTags }])
      );

      const learnings = await extractor.extractFromConversation(
        mockConversation
      );

      expect(learnings[0].tags).toHaveLength(20);
    });
  });
});
