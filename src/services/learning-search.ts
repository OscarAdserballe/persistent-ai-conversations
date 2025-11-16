import Database from 'better-sqlite3'
import {
  EmbeddingModel,
  VectorStoreExtended,
  LearningSearch,
  LearningSearchOptions,
  LearningSearchResult,
  Learning
} from '../core/types'

/**
 * Semantic search over learnings.
 * Uses VectorStore for core search, enriches with domain-specific data.
 */
export class LearningSearchImpl implements LearningSearch {
  constructor(
    private embedder: EmbeddingModel,
    private vectorStore: VectorStoreExtended,
    private db: Database.Database
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

    // 3. Fetch learning details and apply filters
    const learningIds = vectorResults.map(r => r.id)
    const placeholders = learningIds.map(() => '?').join(',')

    let sql = `
      SELECT
        l.*,
        c.uuid as conv_uuid, c.name as conv_title, c.created_at as conv_date
      FROM learnings l
      LEFT JOIN conversations c ON l.conversation_uuid = c.uuid
      WHERE l.learning_id IN (${placeholders})
    `

    const params: any[] = [...learningIds]

    // Apply date filter
    if (options?.dateRange) {
      sql += ` AND l.created_at >= ? AND l.created_at <= ?`
      params.push(options.dateRange.start.toISOString(), options.dateRange.end.toISOString())
    }

    // Apply learning type filter
    if (options?.learningType) {
      sql += ` AND l.learning_type = ?`
      params.push(options.learningType)
    }

    const rows = this.db.prepare(sql).all(...params) as any[]

    // 4. Parse JSON fields and apply tag filter
    const results: LearningSearchResult[] = []
    const scoreMap = new Map(vectorResults.map(r => [r.id, r.score]))

    for (const row of rows) {
      const tags = JSON.parse(row.tags) as string[]

      // Apply tag filter (OR logic: match any tag)
      if (options?.tags && options.tags.length > 0) {
        const hasMatchingTag = options.tags.some(filterTag =>
          tags.some(learningTag => learningTag.toLowerCase().includes(filterTag.toLowerCase()))
        )
        if (!hasMatchingTag) {
          continue
        }
      }

      // Parse nested JSON objects
      const abstraction = JSON.parse(row.abstraction)
      const understanding = JSON.parse(row.understanding)
      const effort = JSON.parse(row.effort)
      const resonance = JSON.parse(row.resonance)

      const learning: Learning = {
        learningId: row.learning_id,
        title: row.title,
        context: row.context,
        insight: row.insight,
        why: row.why,
        implications: row.implications,
        tags,
        abstraction: {
          concrete: abstraction.concrete,
          pattern: abstraction.pattern,
          principle: abstraction.principle
        },
        understanding: {
          confidence: understanding.confidence,
          canTeachIt: understanding.canTeachIt,
          knownGaps: understanding.knownGaps
        },
        effort: {
          processingTime: effort.processingTime,
          cognitiveLoad: effort.cognitiveLoad
        },
        resonance: {
          intensity: resonance.intensity,
          valence: resonance.valence
        },
        learningType: row.learning_type,
        sourceCredit: row.source_credit,
        conversationUuid: row.conversation_uuid,
        createdAt: new Date(row.created_at)
      }

      const result: LearningSearchResult = {
        learning,
        score: scoreMap.get(row.learning_id) || 0,
        sourceConversation: row.conv_uuid ? {
          uuid: row.conv_uuid,
          title: row.conv_title,
          createdAt: new Date(row.conv_date)
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
