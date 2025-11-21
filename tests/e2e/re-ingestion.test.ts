import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { unlinkSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { createDefaultConfig } from "../../src/config";
import { createDatabase } from "../../src/factories";
import { getRawDb } from "../../src/db/client";

describe("Re-ingestion E2E", () => {
  const testDbPath = join(__dirname, "../tmp/e2e-reingestion-test.db");
  const testConfigPath = join(__dirname, "../tmp/e2e-reingestion-config.json");
  const minimalFixturePath = join(
    __dirname,
    "../fixtures/conversations/minimal.json"
  );

  beforeEach(() => {
    // Clean up any existing test files
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
    if (existsSync(testDbPath + "-shm")) {
      unlinkSync(testDbPath + "-shm");
    }
    if (existsSync(testDbPath + "-wal")) {
      unlinkSync(testDbPath + "-wal");
    }
    if (existsSync(testConfigPath)) {
      unlinkSync(testConfigPath);
    }

    // Create test config
    const testConfig = {
      ...createDefaultConfig(),
      db: { path: testDbPath },
      ingestion: {
        batchSize: 10,
        progressLogging: false,
        concurrency: 50,
      },
    };

    writeFileSync(testConfigPath, JSON.stringify(testConfig, null, 2));
  });

  afterEach(() => {
    // Clean up test files
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
    if (existsSync(testDbPath + "-shm")) {
      unlinkSync(testDbPath + "-shm");
    }
    if (existsSync(testDbPath + "-wal")) {
      unlinkSync(testDbPath + "-wal");
    }
    if (existsSync(testConfigPath)) {
      unlinkSync(testConfigPath);
    }
  });

  it("should handle re-ingesting the same file without errors (UPSERT)", () => {
    // First ingestion
    const firstOutput = execSync(
      `npx tsx src/cli/ingest.ts "${minimalFixturePath}" --config "${testConfigPath}"`,
      { encoding: "utf-8", cwd: join(__dirname, "../..") }
    );

    expect(firstOutput).toContain("Successfully imported");

    // Get counts after first ingestion
    const drizzleDb1 = createDatabase(testDbPath);
    const db1 = getRawDb(drizzleDb1);
    const firstConvCount = db1
      .prepare("SELECT COUNT(*) as count FROM conversations")
      .get() as { count: number };
    const firstMsgCount = db1
      .prepare("SELECT COUNT(*) as count FROM messages")
      .get() as { count: number };
    const firstChunkCount = db1
      .prepare("SELECT COUNT(*) as count FROM message_chunks")
      .get() as { count: number };
    db1.close();

    // Second ingestion (should not crash or duplicate)
    const secondOutput = execSync(
      `npx tsx src/cli/ingest.ts "${minimalFixturePath}" --config "${testConfigPath}"`,
      { encoding: "utf-8", cwd: join(__dirname, "../..") }
    );

    expect(secondOutput).toContain("Successfully imported");

    // Get counts after second ingestion
    const drizzleDb2 = createDatabase(testDbPath);
    const db2 = getRawDb(drizzleDb2);
    const secondConvCount = db2
      .prepare("SELECT COUNT(*) as count FROM conversations")
      .get() as { count: number };
    const secondMsgCount = db2
      .prepare("SELECT COUNT(*) as count FROM messages")
      .get() as { count: number };
    const secondChunkCount = db2
      .prepare("SELECT COUNT(*) as count FROM message_chunks")
      .get() as { count: number };
    db2.close();

    // Counts should be identical (no duplicates)
    expect(secondConvCount.count).toBe(firstConvCount.count);
    expect(secondMsgCount.count).toBe(firstMsgCount.count);
    expect(secondChunkCount.count).toBe(firstChunkCount.count);

    // Verify no duplicate UUIDs
    const drizzleDb3 = createDatabase(testDbPath);
    const db3 = getRawDb(drizzleDb3);

    const duplicateConvs = db3
      .prepare(
        `
      SELECT uuid, COUNT(*) as count 
      FROM conversations 
      GROUP BY uuid 
      HAVING count > 1
    `
      )
      .all();
    expect(duplicateConvs).toHaveLength(0);

    const duplicateMsgs = db3
      .prepare(
        `
      SELECT uuid, COUNT(*) as count 
      FROM messages 
      GROUP BY uuid 
      HAVING count > 1
    `
      )
      .all();
    expect(duplicateMsgs).toHaveLength(0);

    db3.close();
  }, 120000); // 2 minute timeout for double ingestion

  it("should skip existing conversations on re-ingestion (idempotent)", () => {
    // Create a fixture with initial data
    const initialConversation = [
      {
        uuid: "test-conv-1",
        name: "Initial Title",
        summary: "Initial summary",
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
        chat_messages: [
          {
            uuid: "msg-1",
            sender: "human",
            text: "Hello",
            created_at: "2024-01-01T00:00:00Z",
            content: [{ type: "text", text: "Hello" }],
          },
        ],
      },
    ];

    const initialPath = join(__dirname, "../tmp/initial-conv.json");
    writeFileSync(initialPath, JSON.stringify(initialConversation));

    try {
      // First ingestion
      execSync(
        `npx tsx src/cli/ingest.ts "${initialPath}" --config "${testConfigPath}"`,
        { encoding: "utf-8", cwd: join(__dirname, "../..") }
      );

      // Get original data
      const drizzleDb1 = createDatabase(testDbPath);
      const db1 = getRawDb(drizzleDb1);
      const originalConv = db1
        .prepare("SELECT * FROM conversations WHERE uuid = ?")
        .get("test-conv-1") as any;
      db1.close();

      // Modify the conversation in the file
      const updatedConversation = [
        {
          ...initialConversation[0],
          name: "Updated Title",
          summary: "Updated summary",
          updated_at: "2024-01-02T00:00:00Z",
        },
      ];

      writeFileSync(initialPath, JSON.stringify(updatedConversation));

      // Second ingestion
      execSync(
        `npx tsx src/cli/ingest.ts "${initialPath}" --config "${testConfigPath}"`,
        { encoding: "utf-8", cwd: join(__dirname, "../..") }
      );

      // Verify conversation was NOT updated (skipped instead)
      const drizzleDb2 = createDatabase(testDbPath);
      const db2 = getRawDb(drizzleDb2);
      const conv = db2
        .prepare("SELECT * FROM conversations WHERE uuid = ?")
        .get("test-conv-1") as any;

      // Should still have original data (not updated)
      expect(conv.name).toBe("Initial Title");
      expect(conv.summary).toBe("Initial summary");

      // Should still only have 1 conversation and 1 message
      const convCount = db2
        .prepare("SELECT COUNT(*) as count FROM conversations")
        .get() as { count: number };
      const msgCount = db2
        .prepare("SELECT COUNT(*) as count FROM messages")
        .get() as { count: number };

      expect(convCount.count).toBe(1);
      expect(msgCount.count).toBe(1);

      db2.close();
    } finally {
      if (existsSync(initialPath)) {
        unlinkSync(initialPath);
      }
    }
  }, 60000);

  it("should skip re-embedding existing messages (cost optimization)", () => {
    // First ingestion
    execSync(
      `npx tsx src/cli/ingest.ts "${minimalFixturePath}" --config "${testConfigPath}"`,
      { encoding: "utf-8", cwd: join(__dirname, "../..") }
    );

    // Get embedding data after first run
    const drizzleDb1 = createDatabase(testDbPath);
    const db1 = getRawDb(drizzleDb1);
    const firstEmbeddings = db1
      .prepare("SELECT embedding FROM message_chunks ORDER BY id")
      .all() as Array<{ embedding: Buffer }>;
    db1.close();

    // Second ingestion
    execSync(
      `npx tsx src/cli/ingest.ts "${minimalFixturePath}" --config "${testConfigPath}"`,
      { encoding: "utf-8", cwd: join(__dirname, "../..") }
    );

    // Get embedding data after second run
    const drizzleDb2 = createDatabase(testDbPath);
    const db2 = getRawDb(drizzleDb2);
    const secondEmbeddings = db2
      .prepare("SELECT embedding FROM message_chunks ORDER BY id")
      .all() as Array<{ embedding: Buffer }>;
    db2.close();

    // Embeddings should be identical (not regenerated)
    expect(secondEmbeddings.length).toBe(firstEmbeddings.length);

    for (let i = 0; i < firstEmbeddings.length; i++) {
      expect(
        secondEmbeddings[i].embedding.equals(firstEmbeddings[i].embedding)
      ).toBe(true);
    }
  }, 120000);
});
