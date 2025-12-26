import { eq } from "drizzle-orm";
import { DrizzleDB } from "../db/client";
import { pdfDocuments, topics as topicsTable } from "../db/schema";
import type { Topic } from "../core/types";

/**
 * PDF document with nested topics for sidebar display.
 */
export interface PDFWithTopics {
  id: string;
  filename: string;
  title?: string;
  documentType: string;
  topics: Topic[];
}

/**
 * Maps a topic row to a Topic object (without embedding for lighter payload).
 */
function mapRowToTopic(row: typeof topicsTable.$inferSelect): Topic {
  return {
    topicId: row.topicId,
    title: row.title,
    summary: row.summary,
    keyPoints: row.keyPoints as string[],
    sourcePassages: row.sourcePassages as string[] | undefined,
    sourceText: row.sourceText ?? undefined,
    pdfId: row.pdfId,
    parentTopicId: row.parentTopicId ?? undefined,
    depth: row.depth,
    createdAt: row.createdAt,
    // Omit embedding for lighter API response
  };
}

/**
 * Get all PDFs with their nested topics.
 * Topics are ordered by depth (main topics first, then subtopics).
 */
export function getAllPdfsWithTopics(db: DrizzleDB): PDFWithTopics[] {
  // Get all PDFs
  const pdfs = db.select().from(pdfDocuments).all();

  // Get all topics grouped by PDF
  const allTopics = db
    .select()
    .from(topicsTable)
    .orderBy(topicsTable.pdfId, topicsTable.depth, topicsTable.title)
    .all();

  // Group topics by PDF ID
  const topicsByPdfId = new Map<string, Topic[]>();
  for (const row of allTopics) {
    const pdfId = row.pdfId;
    if (!topicsByPdfId.has(pdfId)) {
      topicsByPdfId.set(pdfId, []);
    }
    topicsByPdfId.get(pdfId)!.push(mapRowToTopic(row));
  }

  // Build result
  return pdfs.map((pdf) => ({
    id: pdf.id,
    filename: pdf.filename,
    title: pdf.title ?? undefined,
    documentType: pdf.documentType ?? "other",
    topics: topicsByPdfId.get(pdf.id) ?? [],
  }));
}

/**
 * Get a single PDF by ID (without topics).
 */
export function getPdfById(
  db: DrizzleDB,
  pdfId: string
): { id: string; filename: string; title?: string; documentType: string } | null {
  const pdf = db
    .select()
    .from(pdfDocuments)
    .where(eq(pdfDocuments.id, pdfId))
    .get();

  if (!pdf) return null;

  return {
    id: pdf.id,
    filename: pdf.filename,
    title: pdf.title ?? undefined,
    documentType: pdf.documentType ?? "other",
  };
}

/**
 * Get a single PDF with its topics.
 */
export function getPdfWithTopics(
  db: DrizzleDB,
  pdfId: string
): PDFWithTopics | null {
  const pdf = db
    .select()
    .from(pdfDocuments)
    .where(eq(pdfDocuments.id, pdfId))
    .get();

  if (!pdf) return null;

  const topics = db
    .select()
    .from(topicsTable)
    .where(eq(topicsTable.pdfId, pdfId))
    .orderBy(topicsTable.depth, topicsTable.title)
    .all();

  return {
    id: pdf.id,
    filename: pdf.filename,
    title: pdf.title ?? undefined,
    documentType: pdf.documentType ?? "other",
    topics: topics.map(mapRowToTopic),
  };
}
