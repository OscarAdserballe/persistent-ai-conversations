import { LlamaParseReader } from "@llamaindex/cloud/reader";
import { Document } from "@llamaindex/core/schema";
import { basename } from "path";
import { PDFParser, ParsedPDF, PDFPage } from "../core/types";

/**
 * PDF parser implementation using LlamaParse.
 * LlamaParse is excellent for academic PDFs with complex layouts.
 *
 * Requires LLAMA_CLOUD_API_KEY environment variable.
 *
 * To swap for another parser:
 * 1. Create a new class implementing PDFParser interface
 * 2. Update createPDFParser() factory function below
 */
export class LlamaParseParser implements PDFParser {
  private reader: LlamaParseReader;

  constructor(options?: { resultType?: "text" | "markdown" }) {
    this.reader = new LlamaParseReader({
      resultType: options?.resultType ?? "markdown",
    });
  }

  async parse(filePath: string): Promise<ParsedPDF> {
    // LlamaParse returns Document objects
    const documents: Document[] = await this.reader.loadData(filePath);

    // Combine all document text
    const fullText = documents.map((doc) => doc.text).join("\n\n---\n\n");

    // LlamaParse doesn't give us page-level info directly,
    // so we treat each document as potentially a page or section
    const pages: PDFPage[] = documents.map((doc, i) => ({
      pageNumber: i + 1,
      text: doc.text,
      charCount: doc.text.length,
    }));

    return {
      filename: basename(filePath),
      title: undefined, // LlamaParse doesn't extract title metadata
      pageCount: documents.length,
      text: fullText,
      pages,
      metadata: {
        parser: "llamaparse",
        documentCount: documents.length,
      },
    };
  }
}

// =============================================================================
// Factory - swap parser implementation here
// =============================================================================

export type PDFParserType = "llamaparse";

/**
 * Factory function to create PDF parser.
 * Change the implementation here to swap parsers globally.
 */
export function createPDFParser(
  type: PDFParserType = "llamaparse"
): PDFParser {
  switch (type) {
    case "llamaparse":
      return new LlamaParseParser();

    default:
      throw new Error(`Unknown PDF parser type: ${type}`);
  }
}
