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
