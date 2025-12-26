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
// PDF DOCUMENTS TABLE
// ============================================================================

export const pdfDocuments = sqliteTable(
  "pdf_documents",
  {
    id: text("id").primaryKey(),
    filename: text("filename").notNull(),
    filepath: text("filepath").notNull(),
    title: text("title"),
    pageCount: integer("page_count").notNull(),
    charCount: integer("char_count").notNull(),
    documentType: text("document_type", {
      enum: ["slides", "paper", "exercises", "other"],
    }).default("other"),
    metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => ({
    filenameIdx: index("idx_pdf_filename").on(table.filename),
    createdIdx: index("idx_pdf_created").on(table.createdAt),
    typeIdx: index("idx_pdf_type").on(table.documentType),
  })
);

export const pdfChunks = sqliteTable(
  "pdf_chunks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    pdfId: text("pdf_id")
      .notNull()
      .references(() => pdfDocuments.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    pageNumber: integer("page_number"),
    text: text("text").notNull(),
    charCount: integer("char_count").notNull(),
    embedding: blob("embedding", { mode: "buffer" }),
  },
  (table) => ({
    pdfIdx: index("idx_pdf_chunks_pdf").on(table.pdfId),
    chunkUnique: unique("pdf_chunks_unique").on(table.pdfId, table.chunkIndex),
  })
);

// ============================================================================
// TOPICS TABLE
// ============================================================================

export const topics = sqliteTable(
  "topics",
  {
    topicId: text("topic_id").primaryKey(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    keyPoints: text("key_points", { mode: "json" }).$type<string[]>().notNull(),
    sourcePassages: text("source_passages", { mode: "json" }).$type<string[]>(),
    sourceText: text("source_text"),
    pdfId: text("pdf_id")
      .notNull()
      .references(() => pdfDocuments.id, { onDelete: "cascade" }),
    parentTopicId: text("parent_topic_id"),
    depth: integer("depth").notNull().default(0),
    embedding: blob("embedding", { mode: "buffer" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => ({
    pdfIdx: index("idx_topics_pdf").on(table.pdfId),
    parentIdx: index("idx_topics_parent").on(table.parentTopicId),
    createdIdx: index("idx_topics_created").on(table.createdAt),
  })
);

// ============================================================================
// LEARNINGS TABLE (Block-based Schema for Flashcards)
// ============================================================================

// Type definitions for JSON columns
export type ContentBlock = {
  blockType: "qa" | "why" | "contrast";
  question: string;
  answer: string;
};

export const learnings = sqliteTable(
  "learnings",
  {
    learningId: text("learning_id").primaryKey(),

    // Core fields
    title: text("title").notNull(),
    problemSpace: text("problem_space").notNull(),
    insight: text("insight").notNull(),

    // JSON column for blocks
    blocks: text("blocks", { mode: "json" }).$type<ContentBlock[]>().notNull(),

    // Polymorphic source tracking (no FK - accepts orphan risk for simplicity)
    sourceType: text("source_type", {
      enum: ["conversation", "topic"],
    }).notNull(),
    sourceId: text("source_id").notNull(),

    // Vector embedding
    embedding: blob("embedding", { mode: "buffer" }).notNull(),

    // Timestamps
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => ({
    createdIdx: index("idx_learnings_created").on(table.createdAt),
    sourceIdx: index("idx_learnings_source").on(table.sourceType, table.sourceId),
  })
);

// ============================================================================
// LEARNING REVIEWS TABLE (for flashcard ratings)
// ============================================================================

export const learningReviews = sqliteTable(
  "learning_reviews",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    learningId: text("learning_id")
      .notNull()
      .references(() => learnings.learningId, { onDelete: "cascade" }),
    blockIndex: integer("block_index"), // NULL for main card, 0-N for blocks
    rating: text("rating", {
      enum: ["forgot", "hard", "good", "easy"],
    }).notNull(),
    reviewedAt: integer("reviewed_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => ({
    learningIdx: index("idx_reviews_learning").on(table.learningId),
    timeIdx: index("idx_reviews_time").on(table.reviewedAt),
  })
);

// ============================================================================
// RELATIONS (for relational queries)
// ============================================================================

export const conversationsRelations = relations(conversations, ({ many }) => ({
  messages: many(messages),
  // Note: learnings now use polymorphic source (sourceType/sourceId), no direct relation
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

export const learningsRelations = relations(learnings, ({ many }) => ({
  reviews: many(learningReviews),
  // Note: source is polymorphic (sourceType/sourceId) - resolve manually in queries
}));

export const learningReviewsRelations = relations(learningReviews, ({ one }) => ({
  learning: one(learnings, {
    fields: [learningReviews.learningId],
    references: [learnings.learningId],
  }),
}));

export const pdfDocumentsRelations = relations(pdfDocuments, ({ many }) => ({
  chunks: many(pdfChunks),
  topics: many(topics),
}));

export const pdfChunksRelations = relations(pdfChunks, ({ one }) => ({
  pdf: one(pdfDocuments, {
    fields: [pdfChunks.pdfId],
    references: [pdfDocuments.id],
  }),
}));

export const topicsRelations = relations(topics, ({ one, many }) => ({
  pdf: one(pdfDocuments, {
    fields: [topics.pdfId],
    references: [pdfDocuments.id],
  }),
  parent: one(topics, {
    fields: [topics.parentTopicId],
    references: [topics.topicId],
    relationName: "topicHierarchy",
  }),
  children: many(topics, { relationName: "topicHierarchy" }),
}));

// ============================================================================
// TYPE INFERENCE (automatically generated from schema)
// ============================================================================

// Select types (reading from DB)
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type MessageChunk = typeof messageChunks.$inferSelect;
export type Learning = typeof learnings.$inferSelect;
export type LearningReview = typeof learningReviews.$inferSelect;
export type PDFDocument = typeof pdfDocuments.$inferSelect;
export type PDFChunk = typeof pdfChunks.$inferSelect;
export type Topic = typeof topics.$inferSelect;

// Insert types (writing to DB)
export type ConversationInsert = typeof conversations.$inferInsert;
export type MessageInsert = typeof messages.$inferInsert;
export type MessageChunkInsert = typeof messageChunks.$inferInsert;
export type LearningInsert = typeof learnings.$inferInsert;
export type LearningReviewInsert = typeof learningReviews.$inferInsert;
export type PDFDocumentInsert = typeof pdfDocuments.$inferInsert;
export type PDFChunkInsert = typeof pdfChunks.$inferInsert;
export type TopicInsert = typeof topics.$inferInsert;
