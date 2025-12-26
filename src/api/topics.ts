import { eq, and } from "drizzle-orm";
import { DrizzleDB } from "../db/client";
import { topics as topicsTable, learnings as learningsTable } from "../db/schema";
import type { Topic, Learning, ContentBlock } from "../core/types";

/**
 * Maps a database row to a Topic object.
 */
function mapRowToTopic(row: typeof topicsTable.$inferSelect): Topic {
  return {
    topicId: row.topicId,
    title: row.title,
    summary: row.summary,
    keyPoints: row.keyPoints as string[],
    sourcePassages: row.sourcePassages as string[] | undefined,
    sourceText: row.sourceText ?? undefined,
    pdfId: row.pdfId,
    parentTopicId: row.parentTopicId ?? undefined,
    depth: row.depth,
    createdAt: row.createdAt,
    embedding: row.embedding
      ? new Float32Array(row.embedding.buffer)
      : undefined,
  };
}

/**
 * Get a topic by its ID.
 */
export function getTopicById(db: DrizzleDB, topicId: string): Topic | null {
  const row = db
    .select()
    .from(topicsTable)
    .where(eq(topicsTable.topicId, topicId))
    .get();

  if (!row) return null;

  return mapRowToTopic(row);
}


/**
 * Get all topics for a PDF, ordered by depth (main topics first, then subtopics).
 */
export function getTopicsByPdfId(db: DrizzleDB, pdfId: string): Topic[] {
  const rows = db
    .select()
    .from(topicsTable)
    .where(eq(topicsTable.pdfId, pdfId))
    .orderBy(topicsTable.depth)
    .all();

  return rows.map(mapRowToTopic);
}

/**
 * Maps a learning row to a Learning object (without embedding for lighter payload).
 */
function mapRowToLearning(row: typeof learningsTable.$inferSelect): Learning {
  return {
    learningId: row.learningId,
    title: row.title,
    problemSpace: row.problemSpace,
    insight: row.insight,
    blocks: row.blocks as ContentBlock[],
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    createdAt: row.createdAt,
    // Omit embedding for lighter API response
  };
}

/**
 * Get all learnings for a specific topic.
 */
export function getLearningsByTopicId(db: DrizzleDB, topicId: string): Learning[] {
  const rows = db
    .select()
    .from(learningsTable)
    .where(
      and(
        eq(learningsTable.sourceType, "topic"),
        eq(learningsTable.sourceId, topicId)
      )
    )
    .all();

  return rows.map(mapRowToLearning);
}
