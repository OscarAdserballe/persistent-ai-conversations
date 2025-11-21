import {
  sqliteTable,
  text,
  integer,
  blob,
  index,
  unique,
} from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";

// ============================================================================
// CORE TABLES
// ============================================================================

export const conversations = sqliteTable(
  "conversations",
  {
    uuid: text("uuid").primaryKey(),
    name: text("name").notNull(),
    summary: text("summary"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    platform: text("platform").notNull().default("claude"),
    messageCount: integer("message_count").notNull().default(0),
  },
  (table) => ({
    createdIdx: index("idx_conversations_created").on(table.createdAt),
    updatedIdx: index("idx_conversations_updated").on(table.updatedAt),
    platformIdx: index("idx_conversations_platform").on(table.platform),
  })
);

export const messages = sqliteTable(
  "messages",
  {
    uuid: text("uuid").primaryKey(),
    conversationUuid: text("conversation_uuid")
      .notNull()
      .references(() => conversations.uuid, { onDelete: "cascade" }),
    conversationIndex: integer("conversation_index").notNull(),
    sender: text("sender", { enum: ["human", "assistant"] }).notNull(),
    text: text("text").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    chunkCount: integer("chunk_count").notNull().default(1),
  },
  (table) => ({
    conversationIdx: index("idx_messages_conversation").on(
      table.conversationUuid
    ),
    senderIdx: index("idx_messages_sender").on(table.sender),
    createdIdx: index("idx_messages_created").on(table.createdAt),
    conversationIndexUnique: unique("messages_conversation_index").on(
      table.conversationUuid,
      table.conversationIndex
    ),
  })
);

export const messageChunks = sqliteTable(
  "message_chunks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    messageUuid: text("message_uuid")
      .notNull()
      .references(() => messages.uuid, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    text: text("text").notNull(),
    charCount: integer("char_count").notNull(),
    embedding: blob("embedding", { mode: "buffer" }),
  },
  (table) => ({
    messageIdx: index("idx_chunks_message").on(table.messageUuid),
    chunkIndexUnique: unique("message_chunks_unique").on(
      table.messageUuid,
      table.chunkIndex
    ),
  })
);

// ============================================================================
// LEARNINGS TABLE (Advanced Epistemic Introspection Schema)
// ============================================================================

// Type definitions for JSON columns
export type Abstraction = {
  concrete: string;
  pattern: string;
  principle?: string;
};

export type Understanding = {
  confidence: number;
  can_teach_it: boolean;
  known_gaps?: string[];
};

export type Effort = {
  processing_time: "5min" | "30min" | "2hr" | "days";
  cognitive_load: "easy" | "moderate" | "hard" | "breakthrough";
};

export type Resonance = {
  intensity: number;
  valence: "positive" | "negative" | "mixed";
};

export type LearningType =
  | "principle"
  | "method"
  | "anti_pattern"
  | "exception";

export const learnings = sqliteTable(
  "learnings",
  {
    learningId: text("learning_id").primaryKey(),

    // Core fields
    title: text("title").notNull(),
    context: text("context").notNull(),
    insight: text("insight").notNull(),
    why: text("why").notNull(),
    implications: text("implications").notNull(),

    // JSON columns with type inference
    tags: text("tags", { mode: "json" }).$type<string[]>().notNull(),
    abstraction: text("abstraction", { mode: "json" })
      .$type<Abstraction>()
      .notNull(),
    understanding: text("understanding", { mode: "json" })
      .$type<Understanding>()
      .notNull(),
    effort: text("effort", { mode: "json" }).$type<Effort>().notNull(),
    resonance: text("resonance", { mode: "json" }).$type<Resonance>().notNull(),

    // Classification
    learningType: text("learning_type", {
      enum: ["principle", "method", "anti_pattern", "exception"],
    }).$type<LearningType>(),
    sourceCredit: text("source_credit"),

    // Source tracking
    conversationUuid: text("conversation_uuid").references(
      () => conversations.uuid,
      { onDelete: "set null" }
    ),

    // Vector embedding
    embedding: blob("embedding", { mode: "buffer" }).notNull(),

    // Timestamps
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => ({
    createdIdx: index("idx_learnings_created").on(table.createdAt),
    typeIdx: index("idx_learnings_type").on(table.learningType),
    conversationIdx: index("idx_learnings_conversation").on(
      table.conversationUuid
    ),
  })
);

// ============================================================================
// RELATIONS (for relational queries)
// ============================================================================

export const conversationsRelations = relations(conversations, ({ many }) => ({
  messages: many(messages),
  learnings: many(learnings),
}));

export const messagesRelations = relations(messages, ({ one, many }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationUuid],
    references: [conversations.uuid],
  }),
  chunks: many(messageChunks),
}));

export const messageChunksRelations = relations(messageChunks, ({ one }) => ({
  message: one(messages, {
    fields: [messageChunks.messageUuid],
    references: [messages.uuid],
  }),
}));

export const learningsRelations = relations(learnings, ({ one }) => ({
  conversation: one(conversations, {
    fields: [learnings.conversationUuid],
    references: [conversations.uuid],
  }),
}));

// ============================================================================
// TYPE INFERENCE (automatically generated from schema)
// ============================================================================

// Select types (reading from DB)
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type MessageChunk = typeof messageChunks.$inferSelect;
export type Learning = typeof learnings.$inferSelect;

// Insert types (writing to DB)
export type ConversationInsert = typeof conversations.$inferInsert;
export type MessageInsert = typeof messages.$inferInsert;
export type MessageChunkInsert = typeof messageChunks.$inferInsert;
export type LearningInsert = typeof learnings.$inferInsert;
