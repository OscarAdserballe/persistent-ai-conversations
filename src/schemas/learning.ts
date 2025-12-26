import { z } from "zod";

/**
 * Block type enum for flashcard content
 */
export const BlockTypeSchema = z.enum(["qa", "why", "contrast"]);

/**
 * Content block schema - a single Q&A pair that becomes a flashcard
 */
export const ContentBlockSchema = z.object({
  blockType: BlockTypeSchema.describe(
    "Type of block: 'qa' for generic Q&A, 'why' for elaborative interrogation, 'contrast' for comparisons"
  ),
  question: z.string().describe("Front of flashcard - the question to test"),
  answer: z.string().describe("Back of flashcard - the answer to reveal"),
});

/**
 * Zod schema for learning extraction JSON output from LLM.
 * Block-based structure for flashcard generation.
 */
export const LearningJSONSchema = z.object({
  title: z
    .string()
    .describe(
      "Descriptive and memorable title - highly specific for recall"
    ),
  problemSpace: z
    .string()
    .describe(
      "When/why would you need this? The situation that makes this knowledge relevant"
    ),
  insight: z
    .string()
    .describe(
      "The core technical or philosophical realization in 1-2 sentences"
    ),
  blocks: z
    .array(ContentBlockSchema)
    .describe(
      "Array of Q&A pairs (aim for 8-15). Include definitions, proof outlines, why questions, and contrasts"
    ),
});

/**
 * Schema for array of learnings (LLM returns an array)
 */
export const LearningsArraySchema = z.array(LearningJSONSchema);

/**
 * Infer TypeScript types from Zod schemas
 */
export type LearningJSONType = z.infer<typeof LearningJSONSchema>;
export type ContentBlockType = z.infer<typeof ContentBlockSchema>;
export type BlockType = z.infer<typeof BlockTypeSchema>;
