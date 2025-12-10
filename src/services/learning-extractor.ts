import {
  EmbeddingModel,
  LearningExtractor,
  Learning,
  type LearningExtractionOptions,
} from "../core/types";
import type { Conversation } from "../core/types";
import { LearningsArraySchema } from "../schemas/learning";
import { DrizzleDB } from "../db/client";
import { learnings as learningsTable, type LearningInsert } from "../db/schema";
import { generateObject, LanguageModel } from "ai";

/**
 * Service for extracting learnings from conversations.
 * Uses LLM to analyze full conversation context.
 */
export class LearningExtractorImpl implements LearningExtractor {
  constructor(
    private model: LanguageModel,
    private embedder: EmbeddingModel,
    private db: DrizzleDB,
    private promptTemplate: string
  ) {}

  async extractFromConversation(
    conversation: Conversation,
    options?: LearningExtractionOptions
  ): Promise<Learning[]> {
    const context = this.buildConversationContext(conversation);
    const prompt = this.promptTemplate;

    const { object } = await generateObject({
      model: this.model,
      schema: LearningsArraySchema,
      prompt: `${prompt}\n\n${context}`,
      experimental_telemetry: {
        isEnabled: true,
        functionId: "extract-learnings",
        metadata: {
          conversationUuid: conversation.uuid,
          title: conversation.title,
          ...(options?.experimentId && { experimentId: options.experimentId }),
          ...(options?.promptVersion && {
            promptVersion: options?.promptVersion,
          }),
          context,
          prompt,
        },
      },
    });

    if (object.length === 0) {
      return [];
    }

    // Build embedding text from new schema fields
    const embeddingTexts = object.map((l) => {
      const faqText = l.faq
        .map((f) => `Q: ${f.question} A: ${f.answer}`)
        .join(" ");
      return `${l.title} ${l.trigger} ${l.insight} ${l.why_points.join(
        " "
      )} ${faqText}`;
    });
    const embeddings = await this.embedder.embedBatch(embeddingTexts);

    const results: Learning[] = [];
    const now = new Date();

    for (let i = 0; i < object.length; i++) {
      const learning = object[i];
      const embedding = embeddings[i];
      const learningId = this.generateUUID();

      const insertData: LearningInsert = {
        learningId,
        title: learning.title,
        trigger: learning.trigger,
        insight: learning.insight,
        whyPoints: learning.why_points,
        faq: learning.faq,
        conversationUuid: conversation.uuid,
        embedding: this.serializeEmbedding(embedding),
        createdAt: now,
      };

      await this.db.insert(learningsTable).values(insertData);

      results.push({
        learningId,
        title: learning.title,
        trigger: learning.trigger,
        insight: learning.insight,
        whyPoints: learning.why_points,
        faq: learning.faq,
        conversationUuid: conversation.uuid,
        createdAt: now,
        embedding,
      });
    }

    return results;
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
