import { z } from "zod";

/**
 * Zod schema for learning extraction JSON output from LLM.
 * Matches the LearningJSON interface from learning-extractor.ts
 */
export const LearningJSONSchema = z.object({
  title: z.string().max(100),
  context: z.string(),
  insight: z.string(),
  why: z.string(),
  implications: z.string(),
  tags: z.array(z.string()),
  abstraction: z.object({
    concrete: z.string(),
    pattern: z.string(),
    principle: z.string().optional(),
  }),
  understanding: z.object({
    confidence: z.number().int().min(1).max(10),
    can_teach_it: z.boolean(),
    known_gaps: z.array(z.string()).optional(),
  }),
  effort: z.object({
    processing_time: z.enum(["5min", "30min", "2hr", "days"]),
    cognitive_load: z.enum(["easy", "moderate", "hard", "breakthrough"]),
  }),
  resonance: z.object({
    intensity: z.number().int().min(1).max(10),
    valence: z.enum(["positive", "negative", "mixed"]),
  }),
  learning_type: z
    .enum(["principle", "method", "anti_pattern", "exception"])
    .optional(),
  source_credit: z.string().optional(),
});

/**
 * Schema for array of learnings (LLM returns an array)
 */
export const LearningsArraySchema = z.array(LearningJSONSchema);

/**
 * Infer TypeScript type from Zod schema
 */
export type LearningJSONType = z.infer<typeof LearningJSONSchema>;

/**
 * Convert Zod schema to Gemini API responseSchema format.
 * Gemini uses a JSON Schema-like format with specific type names.
 *
 * Reference: https://ai.google.dev/gemini-api/docs/structured-output
 */
export function zodToGeminiSchema(): any {
  // Gemini expects schemas in a specific format
  // For our array of learnings, we define the array type with items
  return {
    type: "ARRAY",
    items: {
      type: "OBJECT",
      properties: {
        title: {
          type: "STRING",
          description: "Scannable summary (max 100 chars)",
        },
        context: {
          type: "STRING",
          description: "What triggered this learning",
        },
        insight: {
          type: "STRING",
          description: "What was discovered",
        },
        why: {
          type: "STRING",
          description: "Explanation of WHY this is true",
        },
        implications: {
          type: "STRING",
          description: "When/how to apply this",
        },
        tags: {
          type: "ARRAY",
          items: {
            type: "STRING",
          },
          description: "Free-form tags for retrieval",
        },
        abstraction: {
          type: "OBJECT",
          properties: {
            concrete: {
              type: "STRING",
              description: "Specific instance or example",
            },
            pattern: {
              type: "STRING",
              description: "Generalizable pattern",
            },
            principle: {
              type: "STRING",
              description: "Universal principle (optional)",
              nullable: true,
            },
          },
          required: ["concrete", "pattern"],
        },
        understanding: {
          type: "OBJECT",
          properties: {
            confidence: {
              type: "INTEGER",
              description: "1-10: How well you understand this",
              minimum: 1,
              maximum: 10,
            },
            can_teach_it: {
              type: "BOOLEAN",
              description: "Could you explain it to someone else?",
            },
            known_gaps: {
              type: "ARRAY",
              items: {
                type: "STRING",
              },
              description: "What you still don't understand",
              nullable: true,
            },
          },
          required: ["confidence", "can_teach_it"],
        },
        effort: {
          type: "OBJECT",
          properties: {
            processing_time: {
              type: "STRING",
              enum: ["5min", "30min", "2hr", "days"],
              description: "How long to reach this understanding",
            },
            cognitive_load: {
              type: "STRING",
              enum: ["easy", "moderate", "hard", "breakthrough"],
              description: "Difficulty level",
            },
          },
          required: ["processing_time", "cognitive_load"],
        },
        resonance: {
          type: "OBJECT",
          properties: {
            intensity: {
              type: "INTEGER",
              description: "1-10: How much this insight affected you",
              minimum: 1,
              maximum: 10,
            },
            valence: {
              type: "STRING",
              enum: ["positive", "negative", "mixed"],
              description: "How it felt",
            },
          },
          required: ["intensity", "valence"],
        },
        learning_type: {
          type: "STRING",
          enum: ["principle", "method", "anti_pattern", "exception"],
          description: "Type of learning (optional)",
          nullable: true,
        },
        source_credit: {
          type: "STRING",
          description: "If insight came from someone else (optional)",
          nullable: true,
        },
      },
      required: [
        "title",
        "context",
        "insight",
        "why",
        "implications",
        "tags",
        "abstraction",
        "understanding",
        "effort",
        "resonance",
      ],
    },
  };
}
