/**
 * Text chunking utility for handling large messages.
 * Chunks text by character count with smart boundary detection.
 */

export interface TextChunk {
  text: string
  charCount: number
  index: number
}

/**
 * Chunk text into segments of specified maximum character length.
 * Attempts to break on sentence boundaries when possible.
 *
 * @param text - Text to chunk
 * @param maxChars - Maximum characters per chunk (default: 3000)
 * @returns Array of text chunks
 */
export function chunkText(text: string, maxChars: number = 3000): TextChunk[] {
  // If text fits in one chunk, return it as-is
  if (text.length <= maxChars) {
    return [{
      text,
      charCount: text.length,
      index: 0
    }]
  }

  const chunks: TextChunk[] = []
  let start = 0
  let chunkIndex = 0

  while (start < text.length) {
    let end = start + maxChars

    // If we're not at the end of the text, try to find a sentence boundary
    if (end < text.length) {
      // Look ahead up to 200 chars for a sentence boundary
      const searchText = text.substring(end, Math.min(end + 200, text.length))
      const sentenceMatch = searchText.match(/[.!?]\s/)

      if (sentenceMatch && sentenceMatch.index !== undefined) {
        // Found a sentence boundary, use it
        end += sentenceMatch.index + 2 // Include punctuation and space
      } else {
        // No sentence boundary found, try to break on whitespace
        const lastSpace = text.lastIndexOf(' ', end)
        if (lastSpace > start) {
          end = lastSpace + 1 // Include the space
        }
      }
    } else {
      // We're at or past the end, just take the rest
      end = text.length
    }

    const chunkText = text.substring(start, end).trim()

    if (chunkText.length > 0) {
      chunks.push({
        text: chunkText,
        charCount: chunkText.length,
        index: chunkIndex++
      })
    }

    start = end
  }

  return chunks
}

/**
 * Estimate the number of chunks needed for a text.
 * Useful for pre-allocation or progress tracking.
 *
 * @param textLength - Length of text in characters
 * @param maxChars - Maximum characters per chunk
 * @returns Estimated number of chunks
 */
export function estimateChunkCount(textLength: number, maxChars: number = 3000): number {
  if (textLength <= maxChars) {
    return 1
  }
  return Math.ceil(textLength / maxChars)
}

// =============================================================================
// PDF Chunking
// =============================================================================

import type { PDFPage } from "../core/types"

export interface PDFChunk extends TextChunk {
  pageNumber?: number
}

/**
 * Chunk PDF text with page boundary awareness.
 * Attempts to keep page boundaries when possible, but splits large pages.
 *
 * @param pages - Array of PDF pages with text
 * @param maxChars - Maximum characters per chunk (default: 3000)
 * @returns Array of chunks with page number metadata
 */
export function chunkPDFText(pages: PDFPage[], maxChars: number = 3000): PDFChunk[] {
  const chunks: PDFChunk[] = []
  let currentChunk = ""
  let currentPageStart = 1
  let chunkIndex = 0

  for (const page of pages) {
    // If adding this page would exceed max and we have content, finalize current chunk
    if (currentChunk.length + page.text.length > maxChars && currentChunk.length > 0) {
      chunks.push({
        text: currentChunk.trim(),
        charCount: currentChunk.trim().length,
        index: chunkIndex++,
        pageNumber: currentPageStart,
      })
      currentChunk = ""
      currentPageStart = page.pageNumber
    }

    // If single page exceeds max, split it using existing chunkText logic
    if (page.text.length > maxChars) {
      // First, push any accumulated content
      if (currentChunk.length > 0) {
        chunks.push({
          text: currentChunk.trim(),
          charCount: currentChunk.trim().length,
          index: chunkIndex++,
          pageNumber: currentPageStart,
        })
        currentChunk = ""
      }

      // Split the large page
      const pageChunks = chunkText(page.text, maxChars)
      for (const pc of pageChunks) {
        chunks.push({
          text: pc.text,
          charCount: pc.charCount,
          index: chunkIndex++,
          pageNumber: page.pageNumber,
        })
      }
      currentPageStart = page.pageNumber + 1
    } else {
      // Add page to current chunk with separator
      currentChunk += (currentChunk ? "\n\n" : "") + page.text
    }
  }

  // Don't forget remaining content
  if (currentChunk.trim().length > 0) {
    chunks.push({
      text: currentChunk.trim(),
      charCount: currentChunk.trim().length,
      index: chunkIndex,
      pageNumber: currentPageStart,
    })
  }

  return chunks
}
