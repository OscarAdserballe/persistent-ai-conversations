import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDatabase } from "../../../src/factories";
import { getRawDb, type DrizzleDB } from "../../../src/db/client";
import { LearningSearchImpl } from "../../../src/services/learning-search";
import { MockEmbeddingModel, MockVectorStore } from "../../../src/mocks";
import { unlinkSync } from "fs";
import { resolve } from "path";

describe("LearningSearchImpl", () => {
  let drizzleDb: DrizzleDB;
  let embedder: MockEmbeddingModel;
  let vectorStore: MockVectorStore;
  let search: LearningSearchImpl;
  const dbPath = resolve(__dirname, "../../tmp/learning-search-test.db");

  beforeEach(() => {
    // Create fresh database
    drizzleDb = createDatabase(dbPath);

    // Insert test conversations
    getRawDb(drizzleDb)
      .prepare(
        `
      INSERT INTO conversations (uuid, name, summary, created_at, updated_at, platform)
      VALUES
        ('conv-1', 'TypeScript Discussion', 'About TypeScript', '2025-01-01', '2025-01-01', 'claude'),
        ('conv-2', 'React Tutorial', 'About React', '2025-01-02', '2025-01-02', 'claude')
    `
      )
      .run();

    // Helper to create learning data with simplified schema
    const createLearningData = (
      id: string,
      title: string,
      conversationUuid: string,
      createdAt: string
    ) => {
      const whyPoints = JSON.stringify([
        `Reason 1 for ${title}`,
        `Reason 2 for ${title}`,
      ]);
      const faq = JSON.stringify([
        { question: `Question about ${title}?`, answer: `Answer for ${title}` },
      ]);
      const embedding = Buffer.from(new Float32Array(768).fill(0.5).buffer);

      return {
        id,
        title,
        trigger: `Trigger for ${title}`,
        insight: `Insight for ${title}`,
        whyPoints,
        faq,
        conversationUuid,
        embedding,
        createdAt,
      };
    };

    // Insert test learnings with simplified schema
    const learnings = [
      createLearningData(
        "learn-1",
        "TypeScript Basics",
        "conv-1",
        "2025-01-01"
      ),
      createLearningData("learn-2", "React Hooks", "conv-2", "2025-01-02"),
      createLearningData(
        "learn-3",
        "TypeScript Generics",
        "conv-1",
        "2025-01-03"
      ),
      createLearningData("learn-4", "React Context", "conv-2", "2025-01-04"),
      createLearningData(
        "learn-5",
        "TypeScript Interfaces",
        "conv-1",
        "2025-01-05"
      ),
    ];

    const insertStmt = getRawDb(drizzleDb).prepare(`
      INSERT INTO learnings (
        learning_id, title, trigger, insight, why_points, faq,
        conversation_uuid, embedding, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const l of learnings) {
      insertStmt.run(
        l.id,
        l.title,
        l.trigger,
        l.insight,
        l.whyPoints,
        l.faq,
        l.conversationUuid,
        l.embedding,
        l.createdAt
      );
    }

    // Create mocks
    embedder = new MockEmbeddingModel();
    vectorStore = new MockVectorStore();

    // Initialize vector store with embeddings for learnings
    vectorStore.initialize(768);
    for (let i = 1; i <= 5; i++) {
      const embedding = new Float32Array(768).fill(i / 10);
      vectorStore.insert(`learn-${i}`, embedding);
    }

    // Create search engine
    search = new LearningSearchImpl(embedder, vectorStore, drizzleDb);
  });

  afterEach(() => {
    if (drizzleDb) {
      try {
        getRawDb(drizzleDb).close();
      } catch (e) {
        // Ignore if db is not properly initialized
      }
    }
    try {
      unlinkSync(dbPath);
    } catch (e) {
      // Ignore if file doesn't exist
    }
  });

  describe("search", () => {
    it("should return search results", async () => {
      const results = await search.search("TypeScript");

      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);
    });

    it("should return results with learning, score, and sources", async () => {
      const results = await search.search("TypeScript", { limit: 1 });

      expect(results.length).toBeGreaterThan(0);
      const result = results[0];

      expect(result.learning).toBeDefined();
      expect(result.learning.learningId).toBeDefined();
      expect(result.learning.title).toBeDefined();
      expect(result.learning.trigger).toBeDefined();
      expect(result.learning.insight).toBeDefined();
      expect(result.learning.whyPoints).toBeDefined();
      expect(Array.isArray(result.learning.whyPoints)).toBe(true);
      expect(result.learning.faq).toBeDefined();
      expect(Array.isArray(result.learning.faq)).toBe(true);
      expect(result.score).toBeDefined();
      expect(typeof result.score).toBe("number");
      expect(result.sourceConversation).toBeDefined();
    });

    it("should respect limit parameter", async () => {
      const results = await search.search("TypeScript", { limit: 2 });

      expect(results.length).toBeLessThanOrEqual(2);
    });

    it("should return empty array if no results", async () => {
      // Clear vector store
      vectorStore = new MockVectorStore();
      vectorStore.initialize(768);
      search = new LearningSearchImpl(embedder, vectorStore, drizzleDb);

      const results = await search.search("TypeScript");

      expect(results).toEqual([]);
    });

    it("should embed the query", async () => {
      await search.search("TypeScript");

      expect(embedder.lastTexts).toContain("TypeScript");
    });

    it("should preserve relevance ordering from vector search", async () => {
      const results = await search.search("TypeScript");

      // Results should be sorted by score descending
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
      }
    });
  });

  describe("source conversation enrichment", () => {
    it("should include source conversation metadata", async () => {
      const results = await search.search("TypeScript", { limit: 1 });

      expect(results.length).toBeGreaterThan(0);
      const result = results[0];

      expect(result.sourceConversation).toBeDefined();
      expect(result.sourceConversation?.uuid).toBeDefined();
      expect(result.sourceConversation?.title).toBeDefined();
      expect(result.sourceConversation?.createdAt).toBeDefined();
    });

    it("should link to correct conversation", async () => {
      const results = await search.search("TypeScript");

      // Find a result from conv-1
      const conv1Result = results.find(
        (r) => r.learning.conversationUuid === "conv-1"
      );
      expect(conv1Result).toBeDefined();
      expect(conv1Result?.sourceConversation?.uuid).toBe("conv-1");
      expect(conv1Result?.sourceConversation?.title).toBe(
        "TypeScript Discussion"
      );
    });

    it("should handle learnings with source conversation", async () => {
      const results = await search.search("TypeScript");

      for (const result of results) {
        if (result.learning.conversationUuid) {
          expect(result.sourceConversation).toBeDefined();
        }
      }
    });
  });

  describe("filters", () => {
    it("should filter by date range", async () => {
      const results = await search.search("TypeScript", {
        dateRange: {
          start: new Date("2025-01-01"),
          end: new Date("2025-01-02"),
        },
      });

      // Should only include learnings from Jan 1-2
      for (const result of results) {
        const date = result.learning.createdAt;
        expect(date >= new Date("2025-01-01")).toBe(true);
        expect(date <= new Date("2025-01-02")).toBe(true);
      }
    });

    it("should return empty array when filters exclude all results", async () => {
      const results = await search.search("TypeScript", {
        dateRange: {
          start: new Date("2020-01-01"),
          end: new Date("2020-01-02"),
        },
      });

      expect(results).toEqual([]);
    });
  });

  describe("score ordering", () => {
    it("should preserve vector similarity ordering", async () => {
      const results = await search.search("TypeScript");

      // Results should be sorted by score descending
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
      }
    });

    it("should include scores with results", async () => {
      const results = await search.search("TypeScript");

      for (const result of results) {
        expect(result.score).toBeDefined();
        expect(typeof result.score).toBe("number");
        expect(result.score).toBeGreaterThanOrEqual(0);
        expect(result.score).toBeLessThanOrEqual(1);
      }
    });
  });

  describe("result structure", () => {
    it("should return learning with all required fields", async () => {
      const results = await search.search("TypeScript", { limit: 1 });

      expect(results.length).toBeGreaterThan(0);
      const learning = results[0].learning;

      expect(learning.learningId).toBeDefined();
      expect(learning.title).toBeDefined();
      expect(learning.trigger).toBeDefined();
      expect(learning.insight).toBeDefined();
      expect(learning.whyPoints).toBeDefined();
      expect(learning.faq).toBeDefined();
      expect(learning.createdAt).toBeDefined();
    });

    it("should return score as number between 0 and 1", async () => {
      const results = await search.search("TypeScript");

      for (const result of results) {
        expect(result.score).toBeGreaterThanOrEqual(0);
        expect(result.score).toBeLessThanOrEqual(1);
      }
    });

    it("should return source conversation with complete metadata", async () => {
      const results = await search.search("TypeScript", { limit: 1 });

      expect(results.length).toBeGreaterThan(0);
      const sourceConv = results[0].sourceConversation;

      expect(sourceConv).toBeDefined();
      expect(sourceConv?.uuid).toBeDefined();
      expect(sourceConv?.title).toBeDefined();
      expect(sourceConv?.createdAt).toBeDefined();
    });
  });

  describe("edge cases", () => {
    it("should handle empty query", async () => {
      const results = await search.search("");

      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
    });

    it("should handle query with special characters", async () => {
      const results = await search.search("TypeScript<>!@#$%");

      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
    });

    it("should handle very long query", async () => {
      const longQuery = "TypeScript ".repeat(100);
      const results = await search.search(longQuery);

      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
    });

    it("should handle limit of 0", async () => {
      const results = await search.search("TypeScript", { limit: 0 });

      expect(results).toEqual([]);
    });

    it("should handle very large limit", async () => {
      const results = await search.search("TypeScript", { limit: 10000 });

      expect(results).toBeDefined();
      expect(results.length).toBeLessThanOrEqual(5); // Only 5 learnings in DB
    });

    it("should handle learning with very long title", async () => {
      // Insert learning with very long title
      const longTitle = "A".repeat(1000);
      const whyPoints = JSON.stringify(["reason"]);
      const faq = JSON.stringify([{ question: "q", answer: "a" }]);
      const embedding = Buffer.from(new Float32Array(768).fill(0.5).buffer);

      getRawDb(drizzleDb)
        .prepare(
          `
        INSERT INTO learnings (learning_id, title, trigger, insight, why_points, faq, conversation_uuid, embedding, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
        )
        .run(
          "learn-long",
          longTitle,
          "trigger",
          "insight",
          whyPoints,
          faq,
          "conv-1",
          embedding,
          "2025-01-01"
        );

      vectorStore.insert("learn-long", new Float32Array(768).fill(0.9));

      const results = await search.search("TypeScript");

      expect(results).toBeDefined();
    });

    it("should handle invalid date range (end before start)", async () => {
      const results = await search.search("TypeScript", {
        dateRange: {
          start: new Date("2025-01-05"),
          end: new Date("2025-01-01"),
        },
      });

      expect(results).toEqual([]);
    });
  });
});
