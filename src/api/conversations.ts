import { DrizzleDB } from "../db/client";
import {
  conversations as conversationsTable,
  messages as messagesTable,
} from "../db/schema";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import type { Conversation, Message } from "../core/types";

/**
 * Maps raw database rows to a fully-typed Conversation object.
 */
function mapToConversation(
  convRow: typeof conversationsTable.$inferSelect,
  messagesRaw: (typeof messagesTable.$inferSelect)[]
): Conversation {
  const messages: Message[] = messagesRaw.map((msg) => ({
    uuid: msg.uuid,
    conversationUuid: msg.conversationUuid,
    conversationIndex: msg.conversationIndex,
    sender: msg.sender,
    text: msg.text,
    createdAt: msg.createdAt,
    metadata: {},
  }));

  return {
    uuid: convRow.uuid,
    title: convRow.name,
    platform: convRow.platform,
    messages,
    createdAt: convRow.createdAt,
    updatedAt: convRow.updatedAt,
    summary: convRow.summary ?? undefined,
    metadata: {},
  };
}

/**
 * Fetch messages for a conversation, ordered by index.
 */
function fetchMessages(
  db: DrizzleDB,
  conversationUuid: string
): (typeof messagesTable.$inferSelect)[] {
  return db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.conversationUuid, conversationUuid))
    .orderBy(messagesTable.conversationIndex)
    .all();
}

/**
 * Get a single conversation by UUID.
 * Throws if not found.
 */
export function getConversationByUuid(
  db: DrizzleDB,
  uuid: string
): Conversation {
  const convRow = db
    .select()
    .from(conversationsTable)
    .where(eq(conversationsTable.uuid, uuid))
    .get();

  if (!convRow) {
    throw new Error(`Conversation not found: ${uuid}`);
  }

  const messagesRaw = fetchMessages(db, convRow.uuid);
  return mapToConversation(convRow, messagesRaw);
}

/**
 * Get all conversations within a date range.
 * Returns conversations ordered by createdAt ascending.
 */
export function getConversationsByDateRange(
  db: DrizzleDB,
  start: Date,
  end: Date
): Conversation[] {
  const convRows = db
    .select()
    .from(conversationsTable)
    .where(
      and(
        gte(conversationsTable.createdAt, start),
        lte(conversationsTable.createdAt, end)
      )
    )
    .orderBy(conversationsTable.createdAt)
    .all();

  return convRows.map((convRow) => {
    const messagesRaw = fetchMessages(db, convRow.uuid);
    return mapToConversation(convRow, messagesRaw);
  });
}

/**
 * Get a random conversation, optionally within a date range.
 * Throws if no conversations found.
 */
export function getRandomConversation(
  db: DrizzleDB,
  start?: Date,
  end?: Date
): Conversation {
  let query = db.select().from(conversationsTable);

  if (start && end) {
    query = query.where(
      and(
        gte(conversationsTable.createdAt, start),
        lte(conversationsTable.createdAt, end)
      )
    ) as typeof query;
  }

  const convRow = query
    .orderBy(sql`RANDOM()`)
    .limit(1)
    .get();

  if (!convRow) {
    throw new Error("No conversations found");
  }

  const messagesRaw = fetchMessages(db, convRow.uuid);
  return mapToConversation(convRow, messagesRaw);
}

/**
 * Get conversation UUIDs within a date range (lightweight, no messages).
 * Useful for batch processing where you don't need full conversation data upfront.
 */
export function getConversationUuidsByDateRange(
  db: DrizzleDB,
  start: Date,
  end: Date
): string[] {
  const rows = db
    .select({ uuid: conversationsTable.uuid })
    .from(conversationsTable)
    .where(
      and(
        gte(conversationsTable.createdAt, start),
        lte(conversationsTable.createdAt, end)
      )
    )
    .orderBy(conversationsTable.createdAt)
    .all();

  return rows.map((r) => r.uuid);
}

/**
 * Get basic conversation metadata (no messages) for display purposes.
 */
export function getConversationMetadata(
  db: DrizzleDB,
  uuid: string
): { uuid: string; title: string; createdAt: Date } | null {
  const row = db
    .select({
      uuid: conversationsTable.uuid,
      name: conversationsTable.name,
      createdAt: conversationsTable.createdAt,
    })
    .from(conversationsTable)
    .where(eq(conversationsTable.uuid, uuid))
    .get();

  if (!row) return null;

  return {
    uuid: row.uuid,
    title: row.name,
    createdAt: row.createdAt,
  };
}
