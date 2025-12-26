import {
  EmbeddingModel,
  TopicLearningExtractor,
  Learning,
  ContentBlock,
  Topic,
  type LearningExtractionOptions,
} from "../core/types";
import { LearningsArraySchema } from "../schemas/learning";
import { DrizzleDB } from "../db/client";
import { learnings as learningsTable, type LearningInsert } from "../db/schema";
import { generateObject, LanguageModel } from "ai";
import { randomUUID } from "crypto";

/**
 * Service for extracting learnings from topics (which come from PDFs).
 * Uses LLM to analyze topic content and generate flashcard-ready learnings.
 */
export class TopicLearningExtractorImpl implements TopicLearningExtractor {
  constructor(
    private model: LanguageModel,
    private embedder: EmbeddingModel,
    private db: DrizzleDB,
    private promptTemplate: string
  ) {}

  async extractFromTopic(
    topic: Topic,
    options?: LearningExtractionOptions
  ): Promise<Learning[]> {
    const context = this.buildTopicContext(topic);
    const prompt = this.promptTemplate;

    const { object } = await generateObject({
      model: this.model,
      schema: LearningsArraySchema,
      prompt: `${prompt}\n\n${context}`,
      experimental_telemetry: {
        isEnabled: true,
        functionId: "extract-learnings-from-topic",
        metadata: {
          topicId: topic.topicId,
          title: topic.title,
          pdfId: topic.pdfId,
          ...(options?.experimentId && { experimentId: options.experimentId }),
          ...(options?.promptVersion && {
            promptVersion: options?.promptVersion,
          }),
          ...(options?.modelId && { modelId: options?.modelId }),
        },
      },
    });

    if (object.length === 0) {
      return [];
    }

    // Build embedding text from learning fields
    const embeddingTexts = object.map((l) => {
      const blocksText = l.blocks
        .map((b) => `Q: ${b.question} A: ${b.answer}`)
        .join(" ");
      return `${l.title} ${l.problemSpace} ${l.insight} ${blocksText}`;
    });
    const embeddings = await this.embedder.embedBatch(embeddingTexts);

    const results: Learning[] = [];
    const now = new Date();

    for (let i = 0; i < object.length; i++) {
      const learning = object[i];
      const embedding = embeddings[i];
      const learningId = randomUUID();

      const insertData: LearningInsert = {
        learningId,
        title: learning.title,
        problemSpace: learning.problemSpace,
        insight: learning.insight,
        blocks: learning.blocks as ContentBlock[],
        sourceType: "topic",
        sourceId: topic.topicId,
        embedding: Buffer.from(embedding.buffer),
        createdAt: now,
      };

      await this.db.insert(learningsTable).values(insertData);

      results.push({
        learningId,
        title: learning.title,
        problemSpace: learning.problemSpace,
        insight: learning.insight,
        blocks: learning.blocks as ContentBlock[],
        sourceType: "topic",
        sourceId: topic.topicId,
        createdAt: now,
        embedding,
      });
    }

    return results;
  }

  private buildTopicContext(topic: Topic): string {
    const keyPointsList = topic.keyPoints
      .map((p, i) => `  ${i + 1}. ${p}`)
      .join("\n");

    let context = `TOPIC: ${topic.title}

SUMMARY:
${topic.summary}

KEY POINTS:
${keyPointsList}`;

    if (topic.sourcePassages && topic.sourcePassages.length > 0) {
      const passages = topic.sourcePassages
        .map((p, i) => `  [${i + 1}] "${p}"`)
        .join("\n");
      context += `\n\nSOURCE PASSAGES:\n${passages}`;
    }

    return context;
  }
}
