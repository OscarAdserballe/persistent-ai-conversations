import {
  EmbeddingModel,
  VectorStoreExtended,
  LearningSearch,
  LearningSearchOptions,
  LearningSearchResult,
  Learning
} from '../core/types'
import { DrizzleDB } from '../db/client'
import { learnings, conversations } from '../db/schema'
import { eq, and, gte, lte, inArray } from 'drizzle-orm'

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

  async search(query: string, options?: LearningSearchOptions): Promise<LearningSearchResult[]> {
    // Handle limit=0 edge case
    const limit = options?.limit ?? 20
    if (limit === 0) {
      return []
    }

    // 1. Generate query embedding
    const queryVector = await this.embedder.embed(query)

    // 2. Vector similarity search on learnings table
    const vectorResults = this.vectorStore.searchTable(
      'learnings',
      'learning_id',
      queryVector,
      limit * 2  // Over-fetch to allow for filtering
    )

    if (vectorResults.length === 0) {
      return []
    }

    // 3. Fetch learning details and apply filters using Drizzle
    const learningIds = vectorResults.map(r => r.id)
    const scoreMap = new Map(vectorResults.map(r => [r.id, r.score]))

    // Build filter conditions
    const conditions = [inArray(learnings.learningId, learningIds)]

    if (options?.dateRange) {
      conditions.push(
        gte(learnings.createdAt, options.dateRange.start),
        lte(learnings.createdAt, options.dateRange.end)
      )
    }

    if (options?.learningType) {
      conditions.push(eq(learnings.learningType, options.learningType))
    }

    // Type-safe query with join - Drizzle handles JSON parsing automatically!
    const rows = await this.db
      .select({
        learning: learnings,
        conversation: conversations
      })
      .from(learnings)
      .leftJoin(conversations, eq(learnings.conversationUuid, conversations.uuid))
      .where(and(...conditions))

    // 4. Apply tag filter and build results
    const results: LearningSearchResult[] = []

    for (const row of rows) {
      const { learning: l, conversation: c } = row

      // Apply tag filter (OR logic: match any tag)
      if (options?.tags && options.tags.length > 0) {
        const hasMatchingTag = options.tags.some(filterTag =>
          l.tags.some(learningTag => learningTag.toLowerCase().includes(filterTag.toLowerCase()))
        )
        if (!hasMatchingTag) {
          continue
        }
      }

      // Drizzle already parsed JSON! Just map to TypeScript types
      const learning: Learning = {
        learningId: l.learningId,
        title: l.title,
        context: l.context,
        insight: l.insight,
        why: l.why,
        implications: l.implications,
        tags: l.tags,
        abstraction: l.abstraction,
        understanding: l.understanding,
        effort: l.effort,
        resonance: l.resonance,
        learningType: l.learningType,
        sourceCredit: l.sourceCredit,
        conversationUuid: l.conversationUuid,
        createdAt: l.createdAt,
      }

      const result: LearningSearchResult = {
        learning,
        score: scoreMap.get(l.learningId) || 0,
        sourceConversation: c ? {
          uuid: c.uuid,
          title: c.name,
          createdAt: c.createdAt
        } : undefined
      }

      results.push(result)
    }

    // 5. Sort by score (preserve vector search relevance order)
    results.sort((a, b) => b.score - a.score)

    // 6. Apply limit after filtering
    return results.slice(0, limit)
  }
}
