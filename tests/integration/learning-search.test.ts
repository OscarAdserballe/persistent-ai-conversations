import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { unlinkSync, existsSync } from "fs";
import { join } from "path";
import { createDatabase } from "../../src/factories";
import { getRawDb, type DrizzleDB } from "../../src/db/client";
import { SqliteVectorStore } from "../../src/db/vector-store";
import { LearningSearchImpl } from "../../src/services/learning-search";
import { MockEmbeddingModel } from "../../src/mocks";

describe("Learning Search Pipeline", () => {
  const testDbPath = join(
    __dirname,
    "../tmp/learning-search-integration-test.db"
  );

  let drizzleDb: DrizzleDB;
  let vectorStore: SqliteVectorStore;
  let embedder: MockEmbeddingModel;
  let search: LearningSearchImpl;

  beforeEach(() => {
    // Clean up any existing test database
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }

    // Create fresh Drizzle database
    drizzleDb = createDatabase(testDbPath);

    // Create mock embedder
    embedder = new MockEmbeddingModel();

    // Create vector store and initialize
    vectorStore = new SqliteVectorStore(getRawDb(drizzleDb));
    vectorStore.initialize(embedder.dimensions);

    // Create search engine with DrizzleDB
    search = new LearningSearchImpl(embedder, vectorStore, drizzleDb);
  });

  afterEach(() => {
    getRawDb(drizzleDb).close();
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
  });

  // Helper to insert a learning with simplified schema
  async function insertLearning(
    id: string,
    title: string,
    trigger: string,
    insight: string,
    whyPoints: string[],
    faq: { question: string; answer: string }[],
    conversationUuid: string,
    createdAt: Date | string
  ) {
    const embedding = await embedder.embed(
      `${title} ${trigger} ${insight} ${whyPoints.join(" ")}`
    );
    const whyPointsJson = JSON.stringify(whyPoints);
    const faqJson = JSON.stringify(faq);
    const createdAtMs =
      typeof createdAt === "string"
        ? new Date(createdAt).getTime()
        : createdAt.getTime();

    getRawDb(drizzleDb)
      .prepare(
        `
      INSERT INTO learnings (
        learning_id, title, trigger, insight, why_points, faq,
        conversation_uuid, embedding, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        id,
        title,
        trigger,
        insight,
        whyPointsJson,
        faqJson,
        conversationUuid,
        Buffer.from(embedding.buffer),
        createdAtMs
      );
  }

  it("should search and return learnings with metadata", async () => {
    const now = new Date().toISOString();

    // Insert test conversation
    getRawDb(drizzleDb)
      .prepare(
        `
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES ('conv-1', 'TypeScript Tutorial', '${now}', '${now}', 'claude', 0)
    `
      )
      .run();

    // Insert learning with simplified schema
    await insertLearning(
      "learn-1",
      "TypeScript Intro",
      "Needed to understand TypeScript",
      "TypeScript adds static typing to JavaScript",
      ["Type safety catches bugs early", "Better IDE support"],
      [{ question: "Why TypeScript?", answer: "For type safety" }],
      "conv-1",
      now
    );

    // Search
    const results = await search.search("TypeScript", { limit: 10 });

    expect(results.length).toBeGreaterThan(0);
    const result = results[0];

    // Verify learning data
    expect(result.learning.learningId).toBe("learn-1");
    expect(result.learning.title).toBe("TypeScript Intro");
    expect(result.learning.insight).toContain("TypeScript");

    // Verify simplified schema fields
    expect(result.learning.trigger).toBe("Needed to understand TypeScript");
    expect(result.learning.whyPoints.length).toBe(2);
    expect(result.learning.faq.length).toBe(1);

    // Verify source
    expect(result.sourceConversation).toBeDefined();
    expect(result.sourceConversation?.uuid).toBe("conv-1");
    expect(result.sourceConversation?.title).toBe("TypeScript Tutorial");

    // Verify score
    expect(result.score).toBeGreaterThan(0);
  });

  it("should filter by date range", async () => {
    // Insert learnings at different dates
    const oldDate = new Date("2023-01-01T00:00:00Z");
    const recentDate = new Date("2024-06-01T00:00:00Z");

    // Insert conversation
    getRawDb(drizzleDb)
      .prepare(
        `
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES ('conv-1', 'Test', '${oldDate.toISOString()}', '${oldDate.toISOString()}', 'claude', 0)
    `
      )
      .run();

    // Insert old learning
    await insertLearning(
      "learn-old",
      "Old Learning",
      "Old trigger",
      "test query for date filtering",
      ["reason"],
      [],
      "conv-1",
      oldDate
    );

    // Insert recent learning
    await insertLearning(
      "learn-recent",
      "Recent Learning",
      "Recent trigger",
      "test query for date filtering",
      ["reason"],
      [],
      "conv-1",
      recentDate
    );

    // Search with date filter
    const results = await search.search("test query for date filtering", {
      dateRange: {
        start: new Date("2024-01-01T00:00:00Z"),
        end: new Date("2024-12-31T23:59:59Z"),
      },
      limit: 10,
    });

    // Should only get recent learning
    expect(results.length).toBeGreaterThan(0);
    for (const result of results) {
      expect(result.learning.createdAt.getFullYear()).toBe(2024);
    }
  });

  it("should preserve relevance ordering", async () => {
    const now = new Date().toISOString();

    // Insert conversation
    getRawDb(drizzleDb)
      .prepare(
        `
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES ('conv-1', 'Test', '${now}', '${now}', 'claude', 0)
    `
      )
      .run();

    // Insert learnings with varying similarity to "TypeScript"
    const learnings = [
      { id: "learn-1", insight: "TypeScript is great" },
      { id: "learn-2", insight: "TypeScript and JavaScript" },
      { id: "learn-3", insight: "JavaScript programming" },
      { id: "learn-4", insight: "Python is also good" },
      { id: "learn-5", insight: "TypeScript types" },
    ];

    for (const learning of learnings) {
      await insertLearning(
        learning.id,
        learning.insight,
        "trigger",
        learning.insight,
        ["reason"],
        [],
        "conv-1",
        now
      );
    }

    // Search
    const results = await search.search("TypeScript", { limit: 10 });

    expect(results.length).toBeGreaterThan(0);

    // Scores should be in descending order
    for (let i = 0; i < results.length - 1; i++) {
      expect(results[i].score).toBeGreaterThanOrEqual(results[i + 1].score);
    }
  });

  it("should handle empty results", async () => {
    // Database is empty
    const results = await search.search("nonexistent", { limit: 10 });

    expect(results).toEqual([]);
  });

  it("should limit results correctly", async () => {
    const now = new Date().toISOString();

    // Insert conversation
    getRawDb(drizzleDb)
      .prepare(
        `
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES ('conv-1', 'Test', '${now}', '${now}', 'claude', 0)
    `
      )
      .run();

    // Insert 10 similar learnings
    for (let i = 0; i < 10; i++) {
      await insertLearning(
        `learn-${i}`,
        `Learning ${i} about programming`,
        "trigger",
        `Learning ${i} about programming`,
        ["reason"],
        [],
        "conv-1",
        now
      );
    }

    // Search with limit of 3
    const results = await search.search("programming", { limit: 3 });

    expect(results.length).toBeLessThanOrEqual(3);
  });

  it("should enrich with source conversations", async () => {
    const now = new Date().toISOString();

    // Insert conversation with metadata
    getRawDb(drizzleDb)
      .prepare(
        `
      INSERT INTO conversations (uuid, name, summary, created_at, updated_at, platform, message_count)
      VALUES ('conv-1', 'TypeScript Tutorial', 'A detailed tutorial', '${now}', '${now}', 'claude', 5)
    `
      )
      .run();

    // Insert learning
    await insertLearning(
      "learn-1",
      "TypeScript",
      "trigger",
      "TypeScript content",
      ["reason"],
      [],
      "conv-1",
      now
    );

    // Search
    const results = await search.search("TypeScript", { limit: 10 });

    expect(results.length).toBeGreaterThan(0);

    // Verify source conversation enrichment
    const source = results[0].sourceConversation;
    expect(source?.uuid).toBe("conv-1");
    expect(source?.title).toBe("TypeScript Tutorial");
    expect(source?.createdAt).toBeInstanceOf(Date);
  });

  it("should handle learnings with empty arrays", async () => {
    const now = new Date().toISOString();

    // Insert conversation
    getRawDb(drizzleDb)
      .prepare(
        `
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES ('conv-1', 'Test', '${now}', '${now}', 'claude', 0)
    `
      )
      .run();

    // Insert learning with empty arrays
    await insertLearning(
      "learn-1",
      "Uncategorized",
      "trigger",
      "uncategorized content",
      [],
      [],
      "conv-1",
      now
    );

    // Search
    const results = await search.search("content", { limit: 10 });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].learning.whyPoints).toEqual([]);
    expect(results[0].learning.faq).toEqual([]);
  });

  it("should handle large result sets efficiently", async () => {
    const now = new Date().toISOString();

    // Insert conversation
    getRawDb(drizzleDb)
      .prepare(
        `
      INSERT INTO conversations (uuid, name, created_at, updated_at, platform, message_count)
      VALUES ('conv-1', 'Test', '${now}', '${now}', 'claude', 0)
    `
      )
      .run();

    // Insert 100 learnings
    for (let i = 0; i < 100; i++) {
      await insertLearning(
        `learn-${i}`,
        `Learning ${i} about programming and software development`,
        "trigger",
        `Learning ${i} about programming and software development`,
        ["reason"],
        [],
        "conv-1",
        now
      );
    }

    // Search with limit
    const startTime = Date.now();
    const results = await search.search("programming", { limit: 20 });
    const endTime = Date.now();

    expect(results.length).toBeLessThanOrEqual(20);

    // Should complete reasonably quickly (< 1 second for 100 learnings)
    expect(endTime - startTime).toBeLessThan(1000);
  });
});
