import pLimit from "p-limit";
import { DrizzleDB } from "../db/client";
import { learnings as learningsTable, learningReviews as reviewsTable } from "../db/schema";
import { eq, sql, desc, count, and } from "drizzle-orm";
import type { Learning, LearningExtractor, ContentBlock } from "../core/types";
import { getConversationByUuid } from "./conversations";

/**
 * Maps a database row to a Learning object.
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
    embedding: row.embedding
      ? new Float32Array(row.embedding.buffer)
      : undefined,
  };
}

/**
 * Options for batch learning extraction.
 */
export interface ExtractLearningsOptions {
  db: DrizzleDB;
  extractor: LearningExtractor;
  conversationUuids: string[];
  concurrency?: number;
  overwrite?: boolean;
  onProgress?: (completed: number, total: number, title: string) => void;
  onError?: (uuid: string, error: Error) => void;
}

/**
 * Extract learnings from multiple conversations with concurrency control.
 * Handles retry logic and progress reporting.
 */
export async function extractLearnings(
  options: ExtractLearningsOptions
): Promise<Learning[]> {
  const {
    db,
    extractor,
    conversationUuids,
    concurrency = 10,
    overwrite = false,
    onProgress,
    onError,
  } = options;

  const limit = pLimit(concurrency);
  const total = conversationUuids.length;
  let completed = 0;

  const extractWithRetry = async (
    uuid: string,
    maxRetries = 3
  ): Promise<Learning[]> => {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const conversation = getConversationByUuid(db, uuid);
        return await extractor.extractFromConversation(conversation);
      } catch (error) {
        lastError = error as Error;

        if (attempt < maxRetries) {
          const delayMs = Math.pow(2, attempt) * 1000;
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }

    throw new Error(
      `Failed after ${maxRetries} attempts: ${lastError!.message}`
    );
  };

  const promises = conversationUuids.map((uuid) =>
    limit(async () => {
      // Check if already processed (sourceType='conversation', sourceId=uuid)
      const existing = db
        .select()
        .from(learningsTable)
        .where(
          and(
            eq(learningsTable.sourceType, "conversation"),
            eq(learningsTable.sourceId, uuid)
          )
        )
        .all();

      if (existing.length > 0 && !overwrite) {
        completed++;
        onProgress?.(completed, total, `(skipped)`);
        return [];
      }

      if (existing.length > 0 && overwrite) {
        db.delete(learningsTable)
          .where(
            and(
              eq(learningsTable.sourceType, "conversation"),
              eq(learningsTable.sourceId, uuid)
            )
          )
          .run();
      }

      try {
        const learnings = await extractWithRetry(uuid);
        completed++;
        onProgress?.(completed, total, learnings[0]?.title ?? "(no learnings)");
        return learnings;
      } catch (error) {
        completed++;
        onError?.(uuid, error as Error);
        return [];
      }
    })
  );

  const results = await Promise.all(promises);
  return results.flat();
}

/**
 * Options for paginated learning retrieval.
 */
export interface GetLearningsOptions {
  limit?: number;
  offset?: number;
  sourceType?: "conversation" | "topic";
}

/**
 * Result of paginated learning retrieval.
 */
export interface GetLearningsResult {
  learnings: Learning[];
  total: number;
  hasMore: boolean;
}

/**
 * Get paginated list of learnings, ordered by creation date (newest first).
 */
export function getLearnings(
  db: DrizzleDB,
  options: GetLearningsOptions = {}
): GetLearningsResult {
  const { limit: limitVal = 20, offset = 0, sourceType } = options;

  let query = db
    .select()
    .from(learningsTable)
    .orderBy(desc(learningsTable.createdAt))
    .limit(limitVal)
    .offset(offset);

  if (sourceType) {
    query = query.where(eq(learningsTable.sourceType, sourceType)) as typeof query;
  }

  const rows = query.all();

  let countQuery = db.select({ count: count() }).from(learningsTable);
  if (sourceType) {
    countQuery = countQuery.where(eq(learningsTable.sourceType, sourceType)) as typeof countQuery;
  }
  const totalResult = countQuery.get();

  const total = totalResult?.count ?? 0;

  return {
    learnings: rows.map(mapRowToLearning),
    total,
    hasMore: offset + limitVal < total,
  };
}

/**
 * Get a random learning.
 * Returns null if no learnings exist.
 */
export function getRandomLearning(db: DrizzleDB): Learning | null {
  const row = db
    .select()
    .from(learningsTable)
    .orderBy(sql`RANDOM()`)
    .limit(1)
    .get();

  if (!row) return null;

  return mapRowToLearning(row);
}

/**
 * Get a learning by its ID.
 */
export function getLearningById(
  db: DrizzleDB,
  learningId: string
): Learning | null {
  const row = db
    .select()
    .from(learningsTable)
    .where(eq(learningsTable.learningId, learningId))
    .get();

  if (!row) return null;

  return mapRowToLearning(row);
}

/**
 * Get all learnings for a specific source.
 */
export function getLearningsBySource(
  db: DrizzleDB,
  sourceType: "conversation" | "topic",
  sourceId: string
): Learning[] {
  const rows = db
    .select()
    .from(learningsTable)
    .where(
      and(
        eq(learningsTable.sourceType, sourceType),
        eq(learningsTable.sourceId, sourceId)
      )
    )
    .orderBy(desc(learningsTable.createdAt))
    .all();

  return rows.map(mapRowToLearning);
}

/**
 * Check if a source has existing learnings.
 */
export function hasLearnings(
  db: DrizzleDB,
  sourceType: "conversation" | "topic",
  sourceId: string
): boolean {
  const result = db
    .select({ count: count() })
    .from(learningsTable)
    .where(
      and(
        eq(learningsTable.sourceType, sourceType),
        eq(learningsTable.sourceId, sourceId)
      )
    )
    .get();

  return (result?.count ?? 0) > 0;
}

/**
 * Delete all learnings for a source.
 */
export function deleteLearningsBySource(
  db: DrizzleDB,
  sourceType: "conversation" | "topic",
  sourceId: string
): number {
  const result = db
    .delete(learningsTable)
    .where(
      and(
        eq(learningsTable.sourceType, sourceType),
        eq(learningsTable.sourceId, sourceId)
      )
    )
    .run();

  return result.changes;
}

/**
 * Record a flashcard review rating.
 */
export function recordLearningReview(
  db: DrizzleDB,
  learningId: string,
  rating: "forgot" | "hard" | "good" | "easy",
  blockIndex?: number
): void {
  db.insert(reviewsTable)
    .values({
      learningId,
      blockIndex: blockIndex ?? null,
      rating,
      reviewedAt: new Date(),
    })
    .run();
}

/**
 * Get review history for a learning.
 */
export function getLearningReviews(
  db: DrizzleDB,
  learningId: string
) {
  return db
    .select()
    .from(reviewsTable)
    .where(eq(reviewsTable.learningId, learningId))
    .orderBy(desc(reviewsTable.reviewedAt))
    .all();
}
