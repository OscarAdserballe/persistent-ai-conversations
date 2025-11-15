import Database from "better-sqlite3";
import {
  LLMModel,
  EmbeddingModel,
  VectorStoreExtended,
  LearningExtractor,
  Learning,
  Category,
} from "../core/types";
import type { Conversation } from "../core/types";

interface LearningJSON {
  title: string;
  content: string;
  categories?: string[];
}

/**
 * Service for extracting learnings from conversations.
 * Uses LLM to analyze full conversation context.
 */
export class LearningExtractorImpl implements LearningExtractor {
  constructor(
    private llm: LLMModel,
    private embedder: EmbeddingModel,
    private db: Database.Database
  ) {}

  async extractFromConversation(
    conversation: Conversation
  ): Promise<Learning[]> {
    // 1. Fetch existing categories to provide as context
    const existingCategories = this.db
      .prepare(
        `
      SELECT category_id as categoryId, name, description, created_at as createdAt
      FROM learning_categories
      ORDER BY name ASC
    `
      )
      .all() as Category[];

    // 2. Build conversation context
    const context = this.buildConversationContext(conversation);

    // 3. Generate learnings using LLM with category context
    const prompt = buildLearningExtractionPrompt(existingCategories);
    const response = await this.llm.generateText(prompt, context);

    // 4. Parse JSON response
    let learnings: LearningJSON[];
    try {
      learnings = JSON.parse(response);
    } catch (error) {
      // Silently handle parse errors - return empty array
      return [];
    }

    // Validate it's an array
    if (!Array.isArray(learnings)) {
      // Silently handle non-array responses - return empty array
      return [];
    }

    // If empty, return early
    if (learnings.length === 0) {
      return [];
    }

    // 5. Batch generate embeddings for all learnings (efficient!)
    const embeddingTexts = learnings.map((l) => `${l.title}\n\n${l.content}`);
    const embeddings = await this.embedder.embedBatch(embeddingTexts);

    // 6. Store all learnings in a transaction (ensures atomicity)
    const insertLearnings = this.db.transaction(
      (
        learningsToInsert: LearningJSON[],
        embeddingsToInsert: Float32Array[]
      ) => {
        const results: Learning[] = [];

        for (let i = 0; i < learningsToInsert.length; i++) {
          const learning = learningsToInsert[i];
          const embedding = embeddingsToInsert[i];

          // Generate UUID for learning
          const learningId = this.generateUUID();

          // Insert learning with UUID
          this.db
            .prepare(
              `
          INSERT INTO learnings (learning_id, title, content, created_at, embedding)
          VALUES (?, ?, ?, datetime('now'), ?)
        `
            )
            .run(
              learningId,
              learning.title,
              learning.content,
              this.serializeEmbedding(embedding)
            );

          // Note: Embeddings are stored directly in DB, not via vectorStore.insert()
          // Vector search will read from the learnings table using searchTable()

          // Link to source conversation
          this.db
            .prepare(
              `
          INSERT INTO learning_sources (learning_id, conversation_uuid)
          VALUES (?, ?)
        `
            )
            .run(learningId, conversation.uuid);

          // Handle categories (proper upsert pattern)
          const categories: Category[] = [];
          if (learning.categories && learning.categories.length > 0) {
            for (const categoryName of learning.categories) {
              // Try to find existing category
              let category = existingCategories.find(
                (c) => c.name === categoryName
              );

              if (!category) {
                // Generate UUID for category
                const categoryId = this.generateUUID();

                // Idempotent insert (no-op if exists)
                this.db
                  .prepare(
                    `
                INSERT INTO learning_categories (category_id, name, created_at)
                VALUES (?, ?, datetime('now'))
                ON CONFLICT(name) DO NOTHING
              `
                  )
                  .run(categoryId, categoryName);

                // Fetch the category (works whether we created it or it existed)
                category = this.db
                  .prepare(
                    `
                SELECT category_id as categoryId, name, description, created_at as createdAt
                FROM learning_categories
                WHERE name = ?
              `
                  )
                  .get(categoryName) as Category;

                if (!category) {
                  throw new Error(
                    `Failed to create or fetch category: ${categoryName}`
                  );
                }

                existingCategories.push(category); // Cache for subsequent learnings
              }

              // Assign category to learning
              this.db
                .prepare(
                  `
              INSERT INTO learning_category_assignments (learning_id, category_id)
              VALUES (?, ?)
            `
                )
                .run(learningId, category.categoryId);

              categories.push(category);
            }
          }

          results.push({
            learningId,
            title: learning.title,
            content: learning.content,
            categories,
            createdAt: new Date(),
            sources: [{ conversationUuid: conversation.uuid }],
          });
        }

        return results;
      }
    );

    // Execute transaction atomically
    return insertLearnings(learnings, embeddings);
  }

  private buildConversationContext(conversation: Conversation): string {
    const messages = conversation.messages
      .map((m) => `[${m.sender.toUpperCase()}]: ${m.text}`)
      .join("\n\n");

    return `Conversation: "${
      conversation.title
    }"\nDate: ${conversation.createdAt.toISOString()}\n\n${messages}`;
  }

  private serializeEmbedding(embedding: Float32Array): Buffer {
    return Buffer.from(embedding.buffer);
  }

  private generateUUID(): string {
    // Generate RFC4122 v4 UUID
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
}

/**
 * Build learning extraction prompt with existing categories as context.
 * Provides categories for reference without biasing toward them.
 */
function buildLearningExtractionPrompt(existingCategories: Category[]): string {
  const categoryContext =
    existingCategories.length > 0
      ? `\n\nFor reference, these categories already exist in the system:\n${existingCategories
          .map((c) => `- ${c.name}${c.description ? `: ${c.description}` : ""}`)
          .join(
            "\n"
          )}\n\nYou may use these if they fit well, or create new ones as needed.`
      : "\n\nNo categories exist yet - create relevant ones using lowercase-with-hyphens format.";

  return `
Analyze this conversation and extract distilled learnings. Focus on:

1. **Technical concepts or methodologies** that were genuinely internalized (not just mentioned)
2. **Personal discoveries** in taste, preferences, or understanding (books, music, art, food, design, etc.) with specific reasoning
3. **Key insights or realizations** that demonstrate new understanding or perspective shifts
4. **Patterns or approaches** worth remembering for future reference

**Critical guideline:** Only include learnings where the conversation shows genuine engagement, understanding, or internalization. Casual mentions are NOT learnings.

Return a JSON array of learnings. **If there are no substantial learnings, return an empty array [].**

Each learning must have:
- title: Brief, descriptive title (max 100 chars)
- content: Detailed explanation of what was learned (2-3 sentences)
- categories: Array of category names (use lowercase-with-hyphens format, e.g., "distributed-systems", "jazz-fusion")
${categoryContext}

Examples (only if applicable):
[
  {
    "title": "Event-Driven Architecture Benefits for Microservices",
    "content": "Learned that event sourcing provides natural audit trails and time-travel debugging capabilities. The pattern of storing events rather than state makes it easier to reconstruct system state at any point in time, which is invaluable for debugging production issues in distributed systems.",
    "categories": ["software-architecture", "distributed-systems"]
  },
  {
    "title": "Sourdough Fermentation Temperature Control",
    "content": "Discovered that bulk fermentation at 78°F (25°C) produces tangier bread compared to 68°F (20°C). The warmer temperature accelerates lactobacillus activity relative to yeast, changing the acid profile. This explains why my winter loaves were consistently milder - ambient temperature matters more than I realized.",
    "categories": ["cooking", "baking-science"]
  }
]

If nothing substantial was learned, return: []

Conversation:
`.trim();
}
