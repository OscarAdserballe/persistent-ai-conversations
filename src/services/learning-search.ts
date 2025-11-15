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
      limit
    )

    if (vectorResults.length === 0) {
      return []
    }

    // 3. Create temp table with scores to preserve relevance ordering
    this.db.exec('CREATE TEMP TABLE IF NOT EXISTS temp_learning_scores (id TEXT PRIMARY KEY, score REAL)')
    this.db.exec('DELETE FROM temp_learning_scores')  // Clear previous search

    const insertScore = this.db.prepare('INSERT INTO temp_learning_scores VALUES (?, ?)')
    const insertScores = this.db.transaction((results: typeof vectorResults) => {
      for (const result of results) {
        insertScore.run(result.id, result.score)
      }
    })
    insertScores(vectorResults)

    // 4. Build query with filters, preserving relevance order
    let sql = `
      SELECT DISTINCT
        l.*,
        tls.score,
        lc.category_id, lc.name as cat_name, lc.description as cat_desc,
        c.uuid as conv_uuid, c.name as conv_title, c.created_at as conv_date
      FROM learnings l
      JOIN temp_learning_scores tls ON l.learning_id = tls.id
      LEFT JOIN learning_category_assignments lca ON l.learning_id = lca.learning_id
      LEFT JOIN learning_categories lc ON lca.category_id = lc.category_id
      LEFT JOIN learning_sources ls ON l.learning_id = ls.learning_id
      LEFT JOIN conversations c ON ls.conversation_uuid = c.uuid
      WHERE 1=1
    `

    const params: any[] = []

    // Apply date filter
    if (options?.dateRange) {
      sql += ` AND l.created_at >= ? AND l.created_at <= ?`
      params.push(options.dateRange.start.toISOString(), options.dateRange.end.toISOString())
    }

    // Apply category filter
    if (options?.categoryNames && options.categoryNames.length > 0) {
      const placeholders = options.categoryNames.map(() => '?').join(',')
      sql += ` AND lc.name IN (${placeholders})`
      params.push(...options.categoryNames)
    }

    // IMPORTANT: Preserve relevance order from vector search
    sql += ` ORDER BY tls.score DESC`

    const rows = this.db.prepare(sql).all(...params) as any[]

    // 5. Group results by learning
    const learningMap = new Map<string, LearningSearchResult>()

    for (const row of rows) {
      if (!learningMap.has(row.learning_id)) {
        learningMap.set(row.learning_id, {
          learning: {
            learningId: row.learning_id,
            title: row.title,
            content: row.content,
            categories: [],
            createdAt: new Date(row.created_at),
            sources: []
          },
          score: row.score,  // Score now comes from JOIN with temp table
          sourceConversations: []
        })
      }

      const result = learningMap.get(row.learning_id)!

      // Add category if present and not duplicate
      if (row.category_id && !result.learning.categories.some(c => c.categoryId === row.category_id)) {
        result.learning.categories.push({
          categoryId: row.category_id,
          name: row.cat_name,
          description: row.cat_desc,
          createdAt: new Date(row.created_at)
        })
      }

      // Add source conversation if not duplicate
      if (row.conv_uuid &&
          !result.sourceConversations.some(c => c.uuid === row.conv_uuid)) {
        result.sourceConversations.push({
          uuid: row.conv_uuid,
          title: row.conv_title,
          createdAt: new Date(row.conv_date)
        })
      }
    }

    return Array.from(learningMap.values())
  }
}
