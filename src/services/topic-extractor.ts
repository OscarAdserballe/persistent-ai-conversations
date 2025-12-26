import { randomUUID } from "crypto";
import { eq, count } from "drizzle-orm";
import { generateObject, LanguageModel } from "ai";
import {
  EmbeddingModel,
  TopicExtractor,
  Topic,
  TopicExtractionOptions,
} from "../core/types";
import { TopicsArraySchema, TopicJSONType } from "../schemas/topic";
import { DrizzleDB } from "../db/client";
import {
  topics as topicsTable,
  pdfDocuments,
  pdfChunks,
  type TopicInsert,
} from "../db/schema";

/**
 * Service for extracting topics from PDF documents.
 * Uses LLM to analyze PDF content and identify key topics.
 */
export class TopicExtractorImpl implements TopicExtractor {
  constructor(
    private model: LanguageModel,
    private embedder: EmbeddingModel,
    private db: DrizzleDB,
    private promptTemplate: string
  ) {}

  async extractFromPDF(
    pdfId: string,
    options?: TopicExtractionOptions
  ): Promise<Topic[]> {
    // 1. Check if topics already exist for this PDF
    const existingCount = this.db
      .select({ count: count() })
      .from(topicsTable)
      .where(eq(topicsTable.pdfId, pdfId))
      .get();

    if ((existingCount?.count ?? 0) > 0 && !options?.overwrite) {
      // Return existing topics instead of re-extracting
      return this.getTopicsByPdfId(pdfId);
    }

    if (options?.overwrite && (existingCount?.count ?? 0) > 0) {
      // Delete existing topics before re-extracting
      this.db.delete(topicsTable).where(eq(topicsTable.pdfId, pdfId)).run();
    }

    // 2. Fetch PDF document
    const pdf = this.db
      .select()
      .from(pdfDocuments)
      .where(eq(pdfDocuments.id, pdfId))
      .get();

    if (!pdf) {
      throw new Error(`PDF not found: ${pdfId}`);
    }

    // 3. Fetch all chunks for this PDF
    const chunks = await this.db
      .select()
      .from(pdfChunks)
      .where(eq(pdfChunks.pdfId, pdfId))
      .orderBy(pdfChunks.chunkIndex)
      .all();

    if (chunks.length === 0) {
      throw new Error(`No chunks found for PDF: ${pdfId}`);
    }

    // 3. Build context from chunks
    const context = this.buildPDFContext(pdf, chunks);

    // 4. Call LLM with structured output
    const { object } = await generateObject({
      model: this.model,
      schema: TopicsArraySchema,
      prompt: `${this.promptTemplate}\n\n${context}`,
      experimental_telemetry: {
        isEnabled: true,
        functionId: "extract-topics",
        metadata: {
          pdfId,
          filename: pdf.filename,
          ...(options?.experimentId && { experimentId: options.experimentId }),
          ...(options?.promptVersion && { promptVersion: options.promptVersion }),
        },
      },
    });

    if (object.length === 0) {
      return [];
    }

    // 5. Generate embeddings for all topics (main + subtopics)
    const { texts: embeddingTexts, count: totalTopics } =
      this.buildEmbeddingTexts(object);
    const embeddings = await this.embedder.embedBatch(embeddingTexts);

    // 6. Store topics and return
    const results = await this.storeTopics(object, embeddings, pdfId);

    return results;
  }

  private buildPDFContext(
    pdf: typeof pdfDocuments.$inferSelect,
    chunks: (typeof pdfChunks.$inferSelect)[]
  ): string {
    const chunkTexts = chunks
      .map(
        (c, i) =>
          `[Chunk ${i + 1}${c.pageNumber ? ` (Page ${c.pageNumber})` : ""}]\n${c.text}`
      )
      .join("\n\n---\n\n");

    return `Document: "${pdf.title || pdf.filename}"
Type: ${pdf.documentType || "unknown"}
Pages: ${pdf.pageCount}

Content:
${chunkTexts}`;
  }

  private buildEmbeddingTexts(topics: TopicJSONType[]): {
    texts: string[];
    count: number;
  } {
    const texts: string[] = [];

    for (const topic of topics) {
      // Main topic embedding text
      texts.push(
        `${topic.title} ${topic.summary} ${topic.key_points.join(" ")}`
      );

      // Subtopic embedding texts
      if (topic.subtopics) {
        for (const subtopic of topic.subtopics) {
          texts.push(
            `${subtopic.title} ${subtopic.summary} ${subtopic.key_points.join(" ")}`
          );
        }
      }
    }

    return { texts, count: texts.length };
  }

  private async storeTopics(
    topics: TopicJSONType[],
    embeddings: Float32Array[],
    pdfId: string
  ): Promise<Topic[]> {
    const results: Topic[] = [];
    const now = new Date();
    let embeddingIndex = 0;

    for (const topic of topics) {
      const topicId = randomUUID();
      const embedding = embeddings[embeddingIndex++];

      // Insert main topic
      const insertData: TopicInsert = {
        topicId,
        title: topic.title,
        summary: topic.summary,
        keyPoints: topic.key_points,
        sourcePassages: [],
        sourceText: topic.source_text ?? null,
        pdfId,
        parentTopicId: null,
        depth: 0,
        embedding: Buffer.from(embedding.buffer),
        createdAt: now,
      };

      await this.db.insert(topicsTable).values(insertData);

      results.push({
        topicId,
        title: topic.title,
        summary: topic.summary,
        keyPoints: topic.key_points,
        sourceText: topic.source_text,
        pdfId,
        depth: 0,
        createdAt: now,
        embedding,
      });

      // Insert subtopics
      if (topic.subtopics) {
        for (const subtopic of topic.subtopics) {
          const subtopicId = randomUUID();
          const subtopicEmbedding = embeddings[embeddingIndex++];

          const subtopicInsertData: TopicInsert = {
            topicId: subtopicId,
            title: subtopic.title,
            summary: subtopic.summary,
            keyPoints: subtopic.key_points,
            sourcePassages: [],
            sourceText: subtopic.source_text ?? null,
            pdfId,
            parentTopicId: topicId,
            depth: 1,
            embedding: Buffer.from(subtopicEmbedding.buffer),
            createdAt: now,
          };

          await this.db.insert(topicsTable).values(subtopicInsertData);

          results.push({
            topicId: subtopicId,
            title: subtopic.title,
            summary: subtopic.summary,
            keyPoints: subtopic.key_points,
            sourceText: subtopic.source_text,
            pdfId,
            parentTopicId: topicId,
            depth: 1,
            createdAt: now,
            embedding: subtopicEmbedding,
          });
        }
      }
    }

    return results;
  }

  /**
   * Get all topics for a PDF, ordered by depth (main topics first, then subtopics).
   */
  private getTopicsByPdfId(pdfId: string): Topic[] {
    const rows = this.db
      .select()
      .from(topicsTable)
      .where(eq(topicsTable.pdfId, pdfId))
      .orderBy(topicsTable.depth)
      .all();

    return rows.map((row) => ({
      topicId: row.topicId,
      title: row.title,
      summary: row.summary,
      keyPoints: row.keyPoints as string[],
      sourcePassages: row.sourcePassages as string[] | undefined,
      pdfId: row.pdfId,
      parentTopicId: row.parentTopicId ?? undefined,
      depth: row.depth,
      createdAt: row.createdAt,
      embedding: row.embedding
        ? new Float32Array(row.embedding.buffer)
        : undefined,
    }));
  }
}
