import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { unlinkSync, existsSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { createDatabase } from "../../src/factories";
import { getRawDb, type DrizzleDB } from "../../src/db/client";
import { SqliteVectorStore } from "../../src/db/vector-store";
import { LearningExtractorImpl } from "../../src/services/learning-extractor";
import { LearningSearchImpl } from "../../src/services/learning-search";
import {
  MockLLMModel,
  MockEmbeddingModel,
  createMockLearnings,
} from '../../src/mocks';
import type { Conversation } from "../../src/core/types";

describe("Learning Workflow E2E", () => {
  const testDbPath = join(__dirname, "../tmp/learning-workflow-e2e-test.db");
  const diaryPath = join(__dirname, "../tmp/test-diary.md");

  let drizzleDb: DrizzleDB;
  let vectorStore: SqliteVectorStore;
  let llm: MockLLMModel;
  let embedder: MockEmbeddingModel;
  let extractor: LearningExtractorImpl;
  let search: LearningSearchImpl;

  beforeEach(() => {
    // Clean up any existing files
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
    if (existsSync(diaryPath)) {
      unlinkSync(diaryPath);
    }

    // Create fresh database
    drizzleDb = createDatabase(testDbPath);

    // Create mocks
    llm = new MockLLMModel();
    embedder = new MockEmbeddingModel();

    // Create vector store
    vectorStore = new SqliteVectorStore(getRawDb(drizzleDb));
    vectorStore.initialize(embedder.dimensions);

    // Create extractor and search
    extractor = new LearningExtractorImpl(llm, embedder, drizzleDb);
    search = new LearningSearchImpl(embedder, vectorStore, drizzleDb);
  });

  afterEach(() => {
    getRawDb(drizzleDb).close();
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
    if (existsSync(diaryPath)) {
      unlinkSync(diaryPath);
    }
  });

  const createConversation = (
    id: string,
    title: string,
    content: string
  ): Conversation => ({
    uuid: id,
    title,
    platform: "claude",
    messages: [
      {
        uuid: `${id}-msg-1`,
        conversationUuid: id,
        conversationIndex: 0,
        sender: "human" as const,
        text: `Tell me about ${content}`,
        createdAt: new Date(),
        metadata: {},
      },
      {
        uuid: `${id}-msg-2`,
        conversationUuid: id,
        conversationIndex: 1,
        sender: "assistant" as const,
        text: `Here's information about ${content}...`,
        createdAt: new Date(),
        metadata: {},
      },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
    metadata: {},
  });

  it("should complete full workflow: ingest → extract → search", async () => {
    // 1. Ingest conversations (simulate)
    const conversation = createConversation(
      "conv-1",
      "TypeScript Tutorial",
      "TypeScript"
    );

    getRawDb(drizzleDb).prepare(
      `
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `
    ).run(
      conversation.uuid,
      conversation.title,
      new Date().toISOString(),
      new Date().toISOString(),
      conversation.platform,
      conversation.messages.length
    );

    // 2. Extract learnings
    llm.setStructuredResponse(
      createMockLearnings([
        {
          title: "TypeScript Basics",
          insight:
            "TypeScript adds static typing to JavaScript for better developer experience.",
          tags: ["programming", "typescript"],
        },
      ])
    );

    const learnings = await extractor.extractFromConversation(conversation);

    expect(learnings).toHaveLength(1);
    expect(learnings[0].title).toBe("TypeScript Basics");

    // 3. Search learnings
    const results = await search.search("TypeScript", { limit: 10 });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].learning.title).toBe("TypeScript Basics");
    expect(results[0].learning.tags.length).toBe(2);
    expect(results[0].sourceConversation?.title).toBe("TypeScript Tutorial");
  });

  it("should handle extraction with no learnings", async () => {
    const conversation = createConversation(
      "conv-1",
      "Casual Chat",
      "nothing important"
    );

    getRawDb(drizzleDb).prepare(
      `
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `
    ).run(
      conversation.uuid,
      conversation.title,
      new Date().toISOString(),
      new Date().toISOString(),
      conversation.platform,
      conversation.messages.length
    );

    // LLM returns empty array (no learnings)
    llm.setEmptyLearnings();

    const learnings = await extractor.extractFromConversation(conversation);

    expect(learnings).toEqual([]);

    // Verify nothing in DB
    const storedLearnings = getRawDb(drizzleDb).prepare("SELECT * FROM learnings").all();
    expect(storedLearnings).toHaveLength(0);
  });

  it("should handle incremental extraction", async () => {
    // First extraction creates learning with tags
    const conv1 = createConversation(
      "conv-1",
      "TypeScript Tutorial",
      "TypeScript"
    );

    getRawDb(drizzleDb).prepare(
      `
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `
    ).run(
      conv1.uuid,
      conv1.title,
      new Date().toISOString(),
      new Date().toISOString(),
      conv1.platform,
      conv1.messages.length
    );

    llm.setStructuredResponse(
      createMockLearnings([
        {
          title: "TypeScript Basics",
          insight: "TypeScript content",
          tags: ["programming", "typescript"],
        },
      ])
    );

    await extractor.extractFromConversation(conv1);

    // Verify first learning was created
    const learningsAfterFirst = getRawDb(drizzleDb).prepare("SELECT * FROM learnings").all();
    expect(learningsAfterFirst).toHaveLength(1);

    // Second extraction creates another learning with same tags
    const conv2 = createConversation(
      "conv-2",
      "TypeScript Advanced",
      "advanced TypeScript"
    );

    getRawDb(drizzleDb).prepare(
      `
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `
    ).run(
      conv2.uuid,
      conv2.title,
      new Date().toISOString(),
      new Date().toISOString(),
      conv2.platform,
      conv2.messages.length
    );

    llm.setStructuredResponse(
      createMockLearnings([
        {
          title: "TypeScript Generics",
          insight: "Generics provide type safety",
          tags: ["programming", "typescript"], // Same tags
        },
      ])
    );

    await extractor.extractFromConversation(conv2);

    // Verify 2 learnings created (tags are stored as JSON in each learning)
    const learnings = getRawDb(drizzleDb).prepare("SELECT * FROM learnings").all();
    expect(learnings).toHaveLength(2);
  });

  it("should support searching extracted learnings", async () => {
    // Extract learnings about different topics
    const conversations = [
      createConversation("conv-1", "TypeScript Tutorial", "TypeScript"),
      createConversation("conv-2", "Python Guide", "Python"),
    ];

    for (const conv of conversations) {
      getRawDb(drizzleDb).prepare(
        `
        INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
        VALUES (?, ?, ?, ?, ?, ?)
      `
      ).run(
        conv.uuid,
        conv.title,
        new Date().toISOString(),
        new Date().toISOString(),
        conv.platform,
        conv.messages.length
      );
    }

    // Set up responses for both extractions
    llm.setStructuredResponses([
      createMockLearnings([
        {
          title: "TypeScript Introduction",
          insight: "TypeScript is a typed superset of JavaScript.",
          tags: ["typescript", "programming"],
        },
      ]),
      createMockLearnings([
        {
          title: "Python Basics",
          insight: "Python is a high-level programming language.",
          tags: ["python", "programming"],
        },
      ]),
    ]);

    // Extract from both
    await extractor.extractFromConversation(conversations[0]);
    await extractor.extractFromConversation(conversations[1]);

    // Search for TypeScript
    const tsResults = await search.search("TypeScript", { limit: 10 });

    expect(tsResults.length).toBeGreaterThan(0);
    expect(tsResults[0].learning.title).toContain("TypeScript");
    expect(tsResults[0].score).toBeGreaterThan(0);

    // Search for Python
    const pyResults = await search.search("Python", { limit: 10 });

    expect(pyResults.length).toBeGreaterThan(0);
    // Note: Mock embedder doesn't guarantee exact semantic matching, so just verify Python learning exists
    const hasPythonResult = pyResults.some((r) =>
      r.learning.title.includes("Python")
    );
    expect(hasPythonResult).toBe(true);
  });

  it("should link learnings back to source conversations", async () => {
    const conversation = createConversation(
      "conv-source",
      "Original Discussion",
      "TypeScript"
    );

    getRawDb(drizzleDb).prepare(
      `
      INSERT INTO conversations (uuid, name, summary, created_at, updated_at, platform, message_count)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `
    ).run(
      conversation.uuid,
      conversation.title,
      "A detailed discussion",
      new Date().toISOString(),
      new Date().toISOString(),
      conversation.platform,
      conversation.messages.length
    );

    llm.setStructuredResponse(
      createMockLearnings([
        {
          title: "TypeScript Learning",
          insight: "Content about TypeScript",
          tags: [],
        },
      ])
    );

    // Extract
    const learnings = await extractor.extractFromConversation(conversation);

    // Search
    const results = await search.search("TypeScript", { limit: 10 });

    expect(results.length).toBeGreaterThan(0);

    // Verify source link (singular, not plural)
    const source = results[0].sourceConversation;
    expect(source?.uuid).toBe("conv-source");
    expect(source?.title).toBe("Original Discussion");

    // Verify we can query the original conversation
    const originalConv = getRawDb(drizzleDb)
      .prepare("SELECT * FROM conversations WHERE uuid = ?")
      .get("conv-source");

    expect((originalConv as any).name).toBe("Original Discussion");
    expect((originalConv as any).summary).toBe("A detailed discussion");
  });

  it("should handle large-scale extraction", async () => {
    // Simulate extracting from 50 conversations
    const conversations: Conversation[] = [];

    for (let i = 0; i < 50; i++) {
      const conv = createConversation(
        `conv-${i}`,
        `Conversation ${i}`,
        `topic ${i}`
      );
      conversations.push(conv);

      getRawDb(drizzleDb).prepare(
        `
        INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
        VALUES (?, ?, ?, ?, ?, ?)
      `
      ).run(
        conv.uuid,
        conv.title,
        new Date().toISOString(),
        new Date().toISOString(),
        conv.platform,
        conv.messages.length
      );
    }

    // Configure LLM to return 1 learning per conversation
    llm.setStructuredResponse(
      createMockLearnings([
        {
          title: "Learning from conversation",
          insight: "Some learning content",
          tags: ["programming"],
        },
      ])
    );

    // Extract from all (with performance timing)
    const startTime = Date.now();

    for (const conv of conversations) {
      await extractor.extractFromConversation(conv);
    }

    const endTime = Date.now();
    const duration = endTime - startTime;

    // Verify all learnings were created
    const learnings = getRawDb(drizzleDb).prepare("SELECT * FROM learnings").all();
    expect(learnings.length).toBe(50);

    // Performance check: should complete in reasonable time (< 5 seconds for 50 extractions with mocks)
    expect(duration).toBeLessThan(5000);

    // Verify data consistency - all learnings have conversation_uuid
    const learningsWithSource = getRawDb(drizzleDb)
      .prepare(
        "SELECT COUNT(*) as count FROM learnings WHERE conversation_uuid IS NOT NULL"
      )
      .get() as any;
    expect(learningsWithSource.count).toBe(50);
  });

  it("should handle complex tag relationships", async () => {
    const conv = createConversation(
      "conv-1",
      "Full Stack Development",
      "full stack"
    );

    getRawDb(drizzleDb).prepare(
      `
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `
    ).run(
      conv.uuid,
      conv.title,
      new Date().toISOString(),
      new Date().toISOString(),
      conv.platform,
      conv.messages.length
    );

    llm.setStructuredResponse(
      createMockLearnings([
        {
          title: "Frontend Frameworks",
          insight: "React and Vue are popular frontend frameworks",
          tags: ["frontend", "javascript", "frameworks"],
        },
        {
          title: "Backend APIs",
          insight: "REST and GraphQL are common API patterns",
          tags: ["backend", "api", "architecture"],
        },
        {
          title: "Database Design",
          insight: "SQL and NoSQL databases have different use cases",
          tags: ["database", "backend", "architecture"],
        },
      ])
    );

    await extractor.extractFromConversation(conv);

    // Verify all 3 learnings were created
    const learnings = getRawDb(drizzleDb).prepare("SELECT * FROM learnings").all() as any[];
    expect(learnings).toHaveLength(3);

    // Verify tags are stored correctly as JSON
    const parsedTags = learnings.map((l: any) => JSON.parse(l.tags));
    expect(parsedTags[0]).toEqual(["frontend", "javascript", "frameworks"]);
    expect(parsedTags[1]).toEqual(["backend", "api", "architecture"]);
    expect(parsedTags[2]).toEqual(["database", "backend", "architecture"]);

    // Verify tag overlap (backend and architecture appear in multiple learnings)
    const learningsWithBackend = learnings.filter((l: any) => {
      const tags = JSON.parse(l.tags);
      return tags.includes("backend");
    });
    expect(learningsWithBackend).toHaveLength(2);

    const learningsWithArchitecture = learnings.filter((l: any) => {
      const tags = JSON.parse(l.tags);
      return tags.includes("architecture");
    });
    expect(learningsWithArchitecture).toHaveLength(2);
  });
});
