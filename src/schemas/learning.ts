import { z } from "zod";

/**
 * FAQ item schema - a question/answer pair from the conversation
 */
export const FAQItemSchema = z.object({
  question: z.string().describe("The skepticism or clarification asked"),
  answer: z.string().describe("The resolution"),
});

/**
 * Zod schema for learning extraction JSON output from LLM.
 * Simplified "Learning Artifact" structure for better recall.
 */
export const LearningJSONSchema = z.object({
  title: z
    .string()
    .describe(
      "Descriptive and catchy title - highly specific so the student can immediately remember the conversation"
    ),
  trigger: z
    .string()
    .describe(
      "Specific problem, blockers that got the user to ask about it initially - the central trigger"
    ),
  insight: z
    .string()
    .describe(
      "The core technical or philosophical realization. Bold assertions, highly specific."
    ),
  why_points: z
    .array(z.string())
    .describe("List of reasons detailing why this is the case"),
  faq: z
    .array(FAQItemSchema)
    .describe(
      "Substantive and non-overlapping Question/Answer pairs synthesized from the conversation"
    ),
});

/**
 * Schema for array of learnings (LLM returns an array)
 */
export const LearningsArraySchema = z.array(LearningJSONSchema);

/**
 * Infer TypeScript type from Zod schema
 */
export type LearningJSONType = z.infer<typeof LearningJSONSchema>;
export type FAQItemType = z.infer<typeof FAQItemSchema>;
