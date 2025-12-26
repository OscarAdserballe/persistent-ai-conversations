import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { unlinkSync, existsSync } from "fs";
import { join } from "path";
import { createDatabase } from "../../src/factories";
import { getRawDb, type DrizzleDB } from "../../src/db/client";
import { SqliteVectorStore } from "../../src/db/vector-store";
import { LearningExtractorImpl } from "../../src/services/learning-extractor";
import { MockEmbeddingModel, createMockLearnings } from "../../src/mocks";
import { generateObject } from "ai";
import type { Conversation } from "../../src/core/types";

vi.mock("ai", () => ({
  generateObject: vi.fn(),
}));

describe("Learning Extraction Pipeline", () => {
  const testDbPath = join(__dirname, "../tmp/learning-extraction-test.db");

  let drizzleDb: DrizzleDB;
  let vectorStore: SqliteVectorStore;
  let embedder: MockEmbeddingModel;
  let extractor: LearningExtractorImpl;
  const generateObjectMock = vi.mocked(generateObject);

  const queueLLMResponse = (
    learnings: ReturnType<typeof createMockLearnings>
  ) => {
    generateObjectMock.mockResolvedValueOnce({ object: learnings });
  };

  const queueEmptyResponse = () => {
    generateObjectMock.mockResolvedValueOnce({ object: [] });
  };

  const TEST_PROMPT = "Integration prompt";

  beforeEach(() => {
    // Clean up any existing test database
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }

    // Create fresh database
    drizzleDb = createDatabase(testDbPath);

    // Create mocks
    embedder = new MockEmbeddingModel();
    generateObjectMock.mockReset();
    generateObjectMock.mockResolvedValue({ object: [] });

    // Create vector store and initialize
    vectorStore = new SqliteVectorStore(getRawDb(drizzleDb));
    vectorStore.initialize(embedder.dimensions);

    // Create extractor (no vector store parameter needed)
    extractor = new LearningExtractorImpl(
      {} as any,
      embedder,
      drizzleDb,
      TEST_PROMPT
    );
  });

  afterEach(() => {
    getRawDb(drizzleDb).close();
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
  });

  const createTestConversation = (): Conversation => ({
    uuid: "test-conv-1",
    title: "TypeScript Discussion",
    platform: "claude",
    messages: [
      {
        uuid: "msg-1",
        conversationUuid: "test-conv-1",
        conversationIndex: 0,
        sender: "human" as const,
        text: "What is TypeScript?",
        createdAt: new Date("2025-01-01"),
        metadata: {},
      },
      {
        uuid: "msg-2",
        conversationUuid: "test-conv-1",
        conversationIndex: 1,
        sender: "assistant" as const,
        text: "TypeScript is a typed superset of JavaScript that compiles to plain JavaScript.",
        createdAt: new Date("2025-01-01"),
        metadata: {},
      },
    ],
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
    metadata: {},
  });

  it("should extract and store learnings end-to-end", async () => {
    const conversation = createTestConversation();

    // Configure LLM to return a learning with new block-based schema
    queueLLMResponse(
      createMockLearnings([
        {
          title: "TypeScript Introduction",
          problemSpace: "Understanding TypeScript basics",
          insight: "TypeScript adds type safety to JavaScript",
        },
      ])
    );

    // Insert conversation into DB
    getRawDb(drizzleDb)
      .prepare(
        `
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        conversation.uuid,
        conversation.title,
        new Date().toISOString(),
        new Date().toISOString(),
        conversation.platform,
        conversation.messages.length
      );

    // Extract learnings
    const learnings = await extractor.extractFromConversation(conversation);

    // Verify learnings were returned
    expect(learnings).toHaveLength(1);
    expect(learnings[0].title).toBe("TypeScript Introduction");
    expect(learnings[0].problemSpace).toBe("Understanding TypeScript basics");
    expect(learnings[0].insight).toBe(
      "TypeScript adds type safety to JavaScript"
    );

    // Verify learnings table
    const storedLearnings = getRawDb(drizzleDb)
      .prepare("SELECT * FROM learnings")
      .all() as any[];
    expect(storedLearnings).toHaveLength(1);
    expect(storedLearnings[0].title).toBe("TypeScript Introduction");

    // Verify source link
    expect(storedLearnings[0].source_type).toBe("conversation");
    expect(storedLearnings[0].source_id).toBe("test-conv-1");
  });

  it("should store blocks as JSON array", async () => {
    const conversation = createTestConversation();

    queueLLMResponse(
      createMockLearnings([
        {
          title: "Test Learning",
          blocks: [
            { blockType: "qa" as const, question: "Q1?", answer: "A1" },
            { blockType: "why" as const, question: "Why?", answer: "Because" },
            { blockType: "contrast" as const, question: "X vs Y?", answer: "Different" },
          ],
        },
      ])
    );

    // Insert conversation
    getRawDb(drizzleDb)
      .prepare(
        `
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        conversation.uuid,
        conversation.title,
        new Date().toISOString(),
        new Date().toISOString(),
        conversation.platform,
        conversation.messages.length
      );

    // Extract
    const learnings = await extractor.extractFromConversation(conversation);

    // Verify blocks in returned learning
    expect(learnings[0].blocks).toHaveLength(3);
    expect(learnings[0].blocks[0].blockType).toBe("qa");

    // Verify blocks in database
    const storedLearnings = getRawDb(drizzleDb)
      .prepare("SELECT blocks FROM learnings")
      .all() as any[];
    const blocks = JSON.parse(storedLearnings[0].blocks);
    expect(blocks).toHaveLength(3);
  });

  it("should handle multiple learnings from one conversation", async () => {
    const conversation = createTestConversation();

    queueLLMResponse(
      createMockLearnings([{ title: "Learning 1" }, { title: "Learning 2" }])
    );

    // Insert conversation
    getRawDb(drizzleDb)
      .prepare(
        `
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        conversation.uuid,
        conversation.title,
        new Date().toISOString(),
        new Date().toISOString(),
        conversation.platform,
        conversation.messages.length
      );

    // Extract
    const learnings = await extractor.extractFromConversation(conversation);

    // Verify both learnings extracted
    expect(learnings).toHaveLength(2);
    expect(learnings[0].title).toBe("Learning 1");
    expect(learnings[1].title).toBe("Learning 2");
  });

  it("should generate valid embeddings", async () => {
    const conversation = createTestConversation();

    queueLLMResponse(
      createMockLearnings([
        {
          title: "Test Learning",
        },
      ])
    );

    // Insert conversation
    getRawDb(drizzleDb)
      .prepare(
        `
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        conversation.uuid,
        conversation.title,
        new Date().toISOString(),
        new Date().toISOString(),
        conversation.platform,
        conversation.messages.length
      );

    // Extract
    await extractor.extractFromConversation(conversation);

    // Verify embedding is stored
    const learnings = getRawDb(drizzleDb)
      .prepare("SELECT * FROM learnings")
      .all() as any[];
    expect(learnings[0].embedding).toBeDefined();
    expect(learnings[0].embedding).toBeInstanceOf(Buffer);

    // Verify embedding dimensions
    const embedding = new Float32Array(learnings[0].embedding.buffer);
    expect(embedding.length).toBe(768);
  });

  it("should batch embed multiple learnings", async () => {
    const conversation = createTestConversation();

    queueLLMResponse(
      createMockLearnings([
        { title: "Learning 1" },
        { title: "Learning 2" },
        { title: "Learning 3" },
      ])
    );

    // Insert conversation
    getRawDb(drizzleDb)
      .prepare(
        `
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        conversation.uuid,
        conversation.title,
        new Date().toISOString(),
        new Date().toISOString(),
        conversation.platform,
        conversation.messages.length
      );

    // Reset embedder to track calls
    embedder.reset();

    // Extract
    await extractor.extractFromConversation(conversation);

    // embedBatch should have been called with all 3 learnings
    expect(embedder.lastTexts).toHaveLength(3);
    expect(embedder.lastTexts[0]).toContain("Learning 1");
    expect(embedder.lastTexts[1]).toContain("Learning 2");
    expect(embedder.lastTexts[2]).toContain("Learning 3");
  });

  it("should set sourceType and sourceId for conversation source", async () => {
    const conversation = createTestConversation();

    queueLLMResponse(
      createMockLearnings([
        {
          title: "Test Learning",
        },
      ])
    );

    // Insert conversation
    getRawDb(drizzleDb)
      .prepare(
        `
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        conversation.uuid,
        conversation.title,
        new Date().toISOString(),
        new Date().toISOString(),
        conversation.platform,
        conversation.messages.length
      );

    // Extract
    const learnings = await extractor.extractFromConversation(conversation);

    // Verify source link in returned learning
    expect(learnings[0].sourceType).toBe("conversation");
    expect(learnings[0].sourceId).toBe("test-conv-1");

    // Verify stored in database
    const storedLearnings = getRawDb(drizzleDb)
      .prepare("SELECT source_type, source_id FROM learnings")
      .all() as any[];
    expect(storedLearnings[0].source_type).toBe("conversation");
    expect(storedLearnings[0].source_id).toBe("test-conv-1");
  });

  it("should handle empty learnings response", async () => {
    const conversation = createTestConversation();

    queueEmptyResponse();

    // Insert conversation
    getRawDb(drizzleDb)
      .prepare(
        `
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        conversation.uuid,
        conversation.title,
        new Date().toISOString(),
        new Date().toISOString(),
        conversation.platform,
        conversation.messages.length
      );

    // Extract
    const learnings = await extractor.extractFromConversation(conversation);

    // Verify no learnings returned
    expect(learnings).toEqual([]);

    // Verify nothing stored in DB
    const storedLearnings = getRawDb(drizzleDb)
      .prepare("SELECT * FROM learnings")
      .all();
    expect(storedLearnings).toHaveLength(0);
  });

  it("should throw ZodError for invalid structured output", async () => {
    const conversation = createTestConversation();

    // Set invalid structured response (missing required fields)
    generateObjectMock.mockResolvedValueOnce({
      object: [{ invalid: "data" }] as any,
    });

    // Insert conversation
    getRawDb(drizzleDb)
      .prepare(
        `
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        conversation.uuid,
        conversation.title,
        new Date().toISOString(),
        new Date().toISOString(),
        conversation.platform,
        conversation.messages.length
      );

    // Extract should throw ZodError
    await expect(
      extractor.extractFromConversation(conversation)
    ).rejects.toThrow();
  });

  it("should generate UUID for learnings", async () => {
    const conversation = createTestConversation();

    queueLLMResponse(
      createMockLearnings([{ title: "Learning 1" }, { title: "Learning 2" }])
    );

    // Insert conversation
    getRawDb(drizzleDb)
      .prepare(
        `
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        conversation.uuid,
        conversation.title,
        new Date().toISOString(),
        new Date().toISOString(),
        conversation.platform,
        conversation.messages.length
      );

    // Extract
    await extractor.extractFromConversation(conversation);

    // Verify UUIDs are generated and unique
    const learnings = getRawDb(drizzleDb)
      .prepare("SELECT learning_id FROM learnings")
      .all() as any[];
    expect(learnings).toHaveLength(2);
    expect(learnings[0].learning_id).toBeDefined();
    expect(learnings[1].learning_id).toBeDefined();
    expect(learnings[0].learning_id).not.toBe(learnings[1].learning_id);

    // Verify UUID format (rough check)
    expect(learnings[0].learning_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  it("should store embeddings in database", async () => {
    const conversation = createTestConversation();

    queueLLMResponse(
      createMockLearnings([
        {
          title: "Test Learning",
        },
      ])
    );

    // Insert conversation
    getRawDb(drizzleDb)
      .prepare(
        `
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        conversation.uuid,
        conversation.title,
        new Date().toISOString(),
        new Date().toISOString(),
        conversation.platform,
        conversation.messages.length
      );

    // Extract
    await extractor.extractFromConversation(conversation);

    // Verify embeddings stored in database
    const learnings = getRawDb(drizzleDb)
      .prepare("SELECT learning_id, embedding FROM learnings")
      .all() as any[];
    expect(learnings).toHaveLength(1);
    expect(learnings[0].embedding).toBeDefined();
  });

  it("should handle multiple extractions sequentially", async () => {
    // First extraction
    const conv1 = createTestConversation();
    queueLLMResponse(createMockLearnings([{ title: "Learning 1" }]));

    getRawDb(drizzleDb)
      .prepare(
        `
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        conv1.uuid,
        conv1.title,
        new Date().toISOString(),
        new Date().toISOString(),
        conv1.platform,
        conv1.messages.length
      );

    await extractor.extractFromConversation(conv1);

    // Second extraction
    const conv2 = { ...createTestConversation(), uuid: "test-conv-2" };
    conv2.messages = conv2.messages.map((m) => ({
      ...m,
      conversationUuid: "test-conv-2",
    }));

    queueLLMResponse(createMockLearnings([{ title: "Learning 2" }]));

    getRawDb(drizzleDb)
      .prepare(
        `
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        conv2.uuid,
        conv2.title,
        new Date().toISOString(),
        new Date().toISOString(),
        conv2.platform,
        conv2.messages.length
      );

    await extractor.extractFromConversation(conv2);

    // Verify 2 learnings created
    const learnings = getRawDb(drizzleDb)
      .prepare("SELECT * FROM learnings")
      .all();
    expect(learnings).toHaveLength(2);
  });
});
