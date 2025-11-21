import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { unlinkSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { createDefaultConfig } from "../../src/config";
import Database from "better-sqlite3";

describe("Ingest Command E2E", () => {
  const testDbPath = join(__dirname, "../tmp/e2e-ingest-test.db");
  const testConfigPath = join(__dirname, "../tmp/e2e-ingest-config.json");
  const minimalFixturePath = join(
    __dirname,
    "../fixtures/conversations/minimal.json"
  );
  const edgeCasesFixturePath = join(
    __dirname,
    "../fixtures/conversations/edge-cases.json"
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

  it("should ingest minimal conversation successfully", () => {
    // Run ingest command
    const output = execSync(
      `npx tsx src/cli/ingest.ts "${minimalFixturePath}" --config "${testConfigPath}"`,
      { encoding: "utf-8", cwd: join(__dirname, "../..") }
    );

    // Verify output messages
    expect(output).toContain("Starting ingestion");
    expect(output).toContain("Loaded configuration");
    expect(output).toContain("Connected to database");
    expect(output).toContain("Initialized embedding model");
    expect(output).toContain("Successfully imported");
    expect(output).toContain("Done!");

    // Verify database was created
    expect(existsSync(testDbPath)).toBe(true);

    // Verify data in database
    const db = new Database(testDbPath);

    const conversations = db.prepare("SELECT * FROM conversations").all();
    expect(conversations.length).toBeGreaterThan(0);

    const messages = db.prepare("SELECT * FROM messages").all();
    expect(messages.length).toBeGreaterThan(0);

    // Verify embeddings were stored in chunks
    const chunksWithEmbeddings = db
      .prepare(
        "SELECT DISTINCT message_uuid FROM message_chunks WHERE embedding IS NOT NULL"
      )
      .all();
    expect(chunksWithEmbeddings.length).toBe(messages.length);

    db.close();
  }, 30000); // 30 second timeout for API calls

  it("should ingest edge cases conversation successfully", () => {
    // Run ingest command with edge cases
    const output = execSync(
      `npx tsx src/cli/ingest.ts "${edgeCasesFixturePath}" --config "${testConfigPath}"`,
      { encoding: "utf-8", cwd: join(__dirname, "../..") }
    );

    // Verify success
    expect(output).toContain("Successfully imported");

    // Verify database
    const db = new Database(testDbPath);

    const messages = db.prepare("SELECT * FROM messages").all();
    expect(messages.length).toBeGreaterThan(0);

    // All messages should have text (no empty strings)
    for (const message of messages) {
      expect((message as any).text).toBeTruthy();
      expect((message as any).text.length).toBeGreaterThan(0);
    }

    db.close();
  }, 30000);

  it("should handle missing file gracefully", () => {
    const nonexistentFile = join(__dirname, "../tmp/nonexistent.json");

    try {
      execSync(
        `npx tsx src/cli/ingest.ts "${nonexistentFile}" --config "${testConfigPath}"`,
        { encoding: "utf-8", cwd: join(__dirname, "../.."), stdio: "pipe" }
      );
      // Should not reach here
      expect(true).toBe(false);
    } catch (error: any) {
      // Should fail with error message
      expect(error.status).not.toBe(0);
      const stderr = error.stderr?.toString() || error.stdout?.toString() || "";
      expect(stderr).toContain("Error");
    }
  });

  it("should handle invalid config file gracefully", () => {
    const invalidConfigPath = join(__dirname, "../tmp/invalid-config.json");
    writeFileSync(invalidConfigPath, "{ invalid json }");

    try {
      execSync(
        `npx tsx src/cli/ingest.ts "${minimalFixturePath}" --config "${invalidConfigPath}"`,
        { encoding: "utf-8", cwd: join(__dirname, "../.."), stdio: "pipe" }
      );
      // Should not reach here
      expect(true).toBe(false);
    } catch (error: any) {
      // Should fail with error
      expect(error.status).not.toBe(0);
    } finally {
      if (existsSync(invalidConfigPath)) {
        unlinkSync(invalidConfigPath);
      }
    }
  });

  it("should handle invalid JSON in conversations file", () => {
    const invalidJsonPath = join(
      __dirname,
      "../tmp/invalid-conversations.json"
    );
    writeFileSync(invalidJsonPath, "{ invalid json }");

    try {
      execSync(
        `npx tsx src/cli/ingest.ts "${invalidJsonPath}" --config "${testConfigPath}"`,
        { encoding: "utf-8", cwd: join(__dirname, "../.."), stdio: "pipe" }
      );
      // Should not reach here
      expect(true).toBe(false);
    } catch (error: any) {
      // Should fail with error
      expect(error.status).not.toBe(0);
    } finally {
      if (existsSync(invalidJsonPath)) {
        unlinkSync(invalidJsonPath);
      }
    }
  });

  it("should create database if it does not exist", () => {
    // Ensure database doesn't exist
    expect(existsSync(testDbPath)).toBe(false);

    // Run ingest
    execSync(
      `npx tsx src/cli/ingest.ts "${minimalFixturePath}" --config "${testConfigPath}"`,
      { encoding: "utf-8", cwd: join(__dirname, "../..") }
    );

    // Database should now exist
    expect(existsSync(testDbPath)).toBe(true);

    // Verify it's a valid SQLite database
    const db = new Database(testDbPath);
    const tables = db
      .prepare(
        `
      SELECT name FROM sqlite_master WHERE type='table'
    `
      )
      .all();

    expect(tables.length).toBeGreaterThan(0);
    db.close();
  }, 30000);

  it("should support custom platform option", () => {
    // Test with explicit --platform claude option
    const output = execSync(
      `npx tsx src/cli/ingest.ts "${minimalFixturePath}" --config "${testConfigPath}" --platform claude`,
      { encoding: "utf-8", cwd: join(__dirname, "../..") }
    );

    expect(output).toContain("Successfully imported");

    // Verify platform in database
    const db = new Database(testDbPath);
    const conversations = db
      .prepare("SELECT platform FROM conversations")
      .all();

    for (const conv of conversations) {
      expect((conv as any).platform).toBe("claude");
    }

    db.close();
  }, 30000);

  it("should batch process messages correctly", () => {
    // Create config with small batch size
    const smallBatchConfig = {
      ...createDefaultConfig(),
      db: { path: testDbPath },
      ingestion: {
        batchSize: 1,
        progressLogging: false,
        concurrency: 1,
      },
    };

    const smallBatchConfigPath = join(
      __dirname,
      "../tmp/small-batch-config.json"
    );
    writeFileSync(
      smallBatchConfigPath,
      JSON.stringify(smallBatchConfig, null, 2)
    );

    try {
      // Run ingest with small batch size
      execSync(
        `npx tsx src/cli/ingest.ts "${minimalFixturePath}" --config "${smallBatchConfigPath}"`,
        { encoding: "utf-8", cwd: join(__dirname, "../..") }
      );

      // Verify all messages were processed
      const db = new Database(testDbPath);
      const messages = db.prepare("SELECT * FROM messages").all();

      expect(messages.length).toBeGreaterThan(0);

      // All should have embeddings in chunks
      const chunksWithEmbeddings = db
        .prepare(
          "SELECT DISTINCT message_uuid FROM message_chunks WHERE embedding IS NOT NULL"
        )
        .all();
      expect(chunksWithEmbeddings.length).toBe(messages.length);

      db.close();
    } finally {
      if (existsSync(smallBatchConfigPath)) {
        unlinkSync(smallBatchConfigPath);
      }
    }
  }, 30000);

  it("should preserve conversation order and indexes", () => {
    execSync(
      `npx tsx src/cli/ingest.ts "${minimalFixturePath}" --config "${testConfigPath}"`,
      { encoding: "utf-8", cwd: join(__dirname, "../..") }
    );

    const db = new Database(testDbPath);

    // Get messages ordered by conversation and index
    const messages = db
      .prepare(
        `
      SELECT conversation_uuid, conversation_index
      FROM messages
      ORDER BY conversation_uuid, conversation_index
    `
      )
      .all() as Array<{
      conversation_uuid: string;
      conversation_index: number;
    }>;

    // Group by conversation and verify sequential ordering within each conversation
    const byConversation = new Map<
      string,
      Array<{ conversation_index: number }>
    >();
    for (const msg of messages) {
      if (!byConversation.has(msg.conversation_uuid)) {
        byConversation.set(msg.conversation_uuid, []);
      }
      byConversation
        .get(msg.conversation_uuid)!
        .push({ conversation_index: msg.conversation_index });
    }

    // Verify each conversation's messages are indexed from 0
    for (const [_, convMessages] of byConversation) {
      convMessages.sort((a, b) => a.conversation_index - b.conversation_index);
      for (let i = 0; i < convMessages.length; i++) {
        expect(convMessages[i].conversation_index).toBe(i);
      }
    }

    db.close();
  }, 30000);

  it("should handle re-running ingest on existing database", () => {
    // First ingestion
    execSync(
      `npx tsx src/cli/ingest.ts "${minimalFixturePath}" --config "${testConfigPath}"`,
      { encoding: "utf-8", cwd: join(__dirname, "../..") }
    );

    const db = new Database(testDbPath);
    const firstCount = db
      .prepare("SELECT COUNT(*) as count FROM messages")
      .get() as { count: number };
    db.close();

    // Second ingestion (should fail or handle duplicates)
    try {
      execSync(
        `npx tsx src/cli/ingest.ts "${minimalFixturePath}" --config "${testConfigPath}"`,
        { encoding: "utf-8", cwd: join(__dirname, "../.."), stdio: "pipe" }
      );

      // If it succeeds, verify no duplicates were created
      const db2 = new Database(testDbPath);
      const secondCount = db2
        .prepare("SELECT COUNT(*) as count FROM messages")
        .get() as { count: number };

      // Count should be the same (no duplicates) or fail
      expect(secondCount.count).toBe(firstCount.count);
      db2.close();
    } catch (error: any) {
      // It's acceptable to fail on duplicate UUIDs (constraint violation)
      const stderr = error.stderr?.toString() || error.stdout?.toString() || "";
      expect(stderr).toContain("Error");
    }
  }, 60000);
});
