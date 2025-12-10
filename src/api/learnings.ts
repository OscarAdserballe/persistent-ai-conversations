import pLimit from "p-limit";
import { DrizzleDB } from "../db/client";
import { learnings as learningsTable } from "../db/schema";
import { eq, sql, desc, count } from "drizzle-orm";
import type { Learning, LearningExtractor } from "../core/types";
import { getConversationByUuid } from "./conversations";

/**
 * Maps a database row to a Learning object.
 */
function mapRowToLearning(row: typeof learningsTable.$inferSelect): Learning {
  return {
    learningId: row.learningId,
    title: row.title,
    trigger: row.trigger,
    insight: row.insight,
    whyPoints: row.whyPoints,
    faq: row.faq,
    conversationUuid: row.conversationUuid ?? undefined,
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
      // Check if already processed
      const existing = db
        .select()
        .from(learningsTable)
        .where(eq(learningsTable.conversationUuid, uuid))
        .all();

      if (existing.length > 0 && !overwrite) {
        completed++;
        onProgress?.(completed, total, `(skipped)`);
        return [];
      }

      if (existing.length > 0 && overwrite) {
        db.delete(learningsTable)
          .where(eq(learningsTable.conversationUuid, uuid))
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
  const { limit: limitVal = 20, offset = 0 } = options;

  const rows = db
    .select()
    .from(learningsTable)
    .orderBy(desc(learningsTable.createdAt))
    .limit(limitVal)
    .offset(offset)
    .all();

  const totalResult = db.select({ count: count() }).from(learningsTable).get();

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
 * Get all learnings for a specific conversation.
 */
export function getLearningsByConversation(
  db: DrizzleDB,
  conversationUuid: string
): Learning[] {
  const rows = db
    .select()
    .from(learningsTable)
    .where(eq(learningsTable.conversationUuid, conversationUuid))
    .orderBy(desc(learningsTable.createdAt))
    .all();

  return rows.map(mapRowToLearning);
}

/**
 * Check if a conversation has existing learnings.
 */
export function hasLearnings(db: DrizzleDB, conversationUuid: string): boolean {
  const result = db
    .select({ count: count() })
    .from(learningsTable)
    .where(eq(learningsTable.conversationUuid, conversationUuid))
    .get();

  return (result?.count ?? 0) > 0;
}

/**
 * Delete all learnings for a conversation.
 */
export function deleteLearningsByConversation(
  db: DrizzleDB,
  conversationUuid: string
): number {
  const result = db
    .delete(learningsTable)
    .where(eq(learningsTable.conversationUuid, conversationUuid))
    .run();

  return result.changes;
}
