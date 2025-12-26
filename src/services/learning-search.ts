import {
  EmbeddingModel,
  VectorStoreExtended,
  LearningSearch,
  LearningSearchOptions,
  LearningSearchResult,
  Learning,
  ContentBlock,
} from "../core/types";
import { DrizzleDB } from "../db/client";
import { learnings as learningsTable, conversations, topics, pdfDocuments } from "../db/schema";
import { eq, and, gte, lte, inArray } from "drizzle-orm";

/**
 * Semantic search over learnings.
 * Uses VectorStore for core search, enriches with domain-specific data.
 */
export class LearningSearchImpl implements LearningSearch {
  constructor(
    private embedder: EmbeddingModel,
    private vectorStore: VectorStoreExtended,
    private db: DrizzleDB
  ) {}

  async search(
    query: string,
    options?: LearningSearchOptions
  ): Promise<LearningSearchResult[]> {
    // Handle limit=0 edge case
    const limit = options?.limit ?? 20;
    if (limit === 0) {
      return [];
    }

    // 1. Generate query embedding
    const queryVector = await this.embedder.embed(query);

    // 2. Vector similarity search on learnings table
    const vectorResults = this.vectorStore.searchTable(
      "learnings",
      "learning_id",
      queryVector,
      limit * 2 // Over-fetch to allow for filtering
    );

    if (vectorResults.length === 0) {
      return [];
    }

    // 3. Fetch learning details and apply filters using Drizzle
    const learningIds = vectorResults.map((r) => r.id);
    const scoreMap = new Map(vectorResults.map((r) => [r.id, r.score]));

    // Build filter conditions
    const conditions = [inArray(learningsTable.learningId, learningIds)];

    if (options?.dateRange) {
      conditions.push(
        gte(learningsTable.createdAt, options.dateRange.start),
        lte(learningsTable.createdAt, options.dateRange.end)
      );
    }

    // Query learnings
    const rows = await this.db
      .select()
      .from(learningsTable)
      .where(and(...conditions));

    // 4. Build results with source enrichment
    const results: LearningSearchResult[] = [];

    for (const l of rows) {
      // Map to Learning type
      const learning: Learning = {
        learningId: l.learningId,
        title: l.title,
        problemSpace: l.problemSpace,
        insight: l.insight,
        blocks: l.blocks as ContentBlock[],
        sourceType: l.sourceType,
        sourceId: l.sourceId,
        createdAt: l.createdAt,
      };

      const result: LearningSearchResult = {
        learning,
        score: scoreMap.get(l.learningId) || 0,
      };

      // Enrich with source metadata based on sourceType
      if (l.sourceType === "conversation") {
        const conv = await this.db
          .select()
          .from(conversations)
          .where(eq(conversations.uuid, l.sourceId))
          .get();

        if (conv) {
          result.sourceConversation = {
            uuid: conv.uuid,
            title: conv.name,
            createdAt: conv.createdAt,
          };
        }
      } else if (l.sourceType === "topic") {
        const topic = await this.db
          .select({
            topic: topics,
            pdf: pdfDocuments,
          })
          .from(topics)
          .leftJoin(pdfDocuments, eq(topics.pdfId, pdfDocuments.id))
          .where(eq(topics.topicId, l.sourceId))
          .get();

        if (topic?.topic) {
          result.sourceTopic = {
            topicId: topic.topic.topicId,
            title: topic.topic.title,
            pdfId: topic.topic.pdfId,
            pdfTitle: topic.pdf?.title ?? topic.pdf?.filename,
          };
        }
      }

      results.push(result);
    }

    // 5. Sort by score (preserve vector search relevance order)
    results.sort((a, b) => b.score - a.score);

    // 6. Apply limit after filtering
    return results.slice(0, limit);
  }
}
