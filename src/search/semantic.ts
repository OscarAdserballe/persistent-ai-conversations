import { SearchEngine, SearchOptions, SearchResult, EmbeddingModel, VectorStore, Message } from '../core/types'
import { DrizzleDB } from '../db/client'
import { messages, conversations } from '../db/schema'
import { eq, and, gte, lte } from 'drizzle-orm'

/**
 * Semantic search engine that coordinates embedding and vector search.
 * Enriches results with conversation context.
 */
export class SemanticSearch implements SearchEngine {
  constructor(
    private embedder: EmbeddingModel,
    private vectorStore: VectorStore,
    private db: DrizzleDB,
    private contextWindow: { before: number; after: number } = { before: 2, after: 1 }
  ) {
    // Initialize vector store with embedding dimensions
    vectorStore.initialize(embedder.dimensions)
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    // 1. Generate query embedding
    const queryVector = await this.embedder.embed(query)

    // 2. Vector similarity search
    const vectorResults = this.vectorStore.search(
      queryVector,
      options.limit || 20
    )

    if (vectorResults.length === 0) {
      return []
    }

    // 3. Apply filters and enrich with context
    const enriched = await this.enrichWithContext(vectorResults, options)

    return enriched
  }

  private async enrichWithContext(
    results: Array<{ id: string; score: number }>,
    options: SearchOptions
  ): Promise<SearchResult[]> {
    const searchResults: SearchResult[] = []

    for (const result of results) {
      // Fetch the matched message
      const message = this.getMessage(result.id)
      if (!message) continue

      // Apply filters
      if (!this.passesFilters(message, options)) {
        continue
      }

      // Fetch conversation metadata
      const conversation = this.getConversation(message.conversationUuid)
      if (!conversation) continue

      // Fetch context messages
      const previousMessages = this.getContextMessages(
        message.conversationUuid,
        message.conversationIndex - this.contextWindow.before,
        message.conversationIndex - 1
      )

      const nextMessages = this.getContextMessages(
        message.conversationUuid,
        message.conversationIndex + 1,
        message.conversationIndex + this.contextWindow.after
      )

      searchResults.push({
        message,
        conversation: {
          uuid: conversation.uuid,
          title: conversation.name,
          summary: conversation.summary,
          createdAt: conversation.createdAt,
          platform: conversation.platform
        },
        score: result.score,
        previousMessages,
        nextMessages
      })
    }

    return searchResults
  }

  private passesFilters(message: Message, options: SearchOptions): boolean {
    // Filter by sender
    if (options.sender && message.sender !== options.sender) {
      return false
    }

    // Filter by date range
    if (options.dateRange) {
      const messageDate = message.createdAt
      if (messageDate < options.dateRange.start || messageDate > options.dateRange.end) {
        return false
      }
    }

    // Filter by conversation UUIDs
    if (options.conversationUuids && options.conversationUuids.length > 0) {
      if (!options.conversationUuids.includes(message.conversationUuid)) {
        return false
      }
    }

    return true
  }

  private getMessage(uuid: string): Message | null {
    const row = this.db
      .select()
      .from(messages)
      .where(eq(messages.uuid, uuid))
      .get()

    if (!row) return null

    return {
      uuid: row.uuid,
      conversationUuid: row.conversationUuid,
      conversationIndex: row.conversationIndex,
      sender: row.sender,
      text: row.text,
      createdAt: row.createdAt,
      metadata: {}
    }
  }

  private getConversation(uuid: string) {
    return this.db
      .select()
      .from(conversations)
      .where(eq(conversations.uuid, uuid))
      .get()
  }

  private getContextMessages(
    conversationUuid: string,
    startIndex: number,
    endIndex: number
  ): Message[] {
    if (startIndex < 0) startIndex = 0
    if (endIndex < startIndex) return []

    const rows = this.db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.conversationUuid, conversationUuid),
          gte(messages.conversationIndex, startIndex),
          lte(messages.conversationIndex, endIndex)
        )
      )
      .orderBy(messages.conversationIndex)
      .all()

    return rows.map(row => ({
      uuid: row.uuid,
      conversationUuid: row.conversationUuid,
      conversationIndex: row.conversationIndex,
      sender: row.sender,
      text: row.text,
      createdAt: row.createdAt,
      metadata: {}
    }))
  }
}
