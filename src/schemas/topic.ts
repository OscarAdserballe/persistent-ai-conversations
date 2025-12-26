import { z } from "zod";

/**
 * Subtopic schema - nested topic within a main topic
 */
const SubtopicSchema = z.object({
  title: z
    .string()
    .describe("Concise, descriptive title for the subtopic (max 100 chars)"),
  summary: z
    .string()
    .describe("1-2 sentence description of what this subtopic covers"),
  key_points: z
    .array(z.string())
    .describe("2-4 key points or takeaways from this subtopic"),
  source_text: z
    .string()
    .optional()
    .describe(
      "The relevant source text from the document for this subtopic. Include actual content, formulas, definitions - not just headings."
    ),
});

/**
 * Zod schema for topic extraction JSON output from LLM.
 * Used with generateObject for structured LLM responses.
 */
export const TopicJSONSchema = z.object({
  title: z
    .string()
    .describe("Concise, descriptive title for the topic (max 100 chars)"),
  summary: z
    .string()
    .describe("1-2 sentence description of what this topic covers"),
  key_points: z
    .array(z.string())
    .describe("3-5 key points or important information about this topic"),
  source_text: z
    .string()
    .optional()
    .describe(
      "The relevant source text from the document for this topic. Include actual content, formulas, definitions, theorems, and explanations - not just headings. This is what students will read alongside flashcards."
    ),
  subtopics: z
    .array(SubtopicSchema)
    .optional()
    .describe("Subtopics within this main topic, if naturally present"),
});

/**
 * Schema for array of topics (LLM returns an array)
 */
export const TopicsArraySchema = z.array(TopicJSONSchema);

/**
 * Infer TypeScript types from Zod schemas
 */
export type TopicJSONType = z.infer<typeof TopicJSONSchema>;
export type SubtopicJSONType = z.infer<typeof SubtopicSchema>;
