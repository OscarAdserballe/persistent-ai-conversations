import type { LearningJSONType, ContentBlockType } from "../schemas/learning";

type LearningOverride = Partial<Omit<LearningJSONType, "blocks">> & {
  blocks?: ContentBlockType[];
};

/**
 * Utility for creating mock learnings in tests.
 * Provides sensible defaults so tests only override the fields they care about.
 */
export function createMockLearnings(
  overrides: LearningOverride[]
): LearningJSONType[] {
  return overrides.map((override, index) => ({
    title: override.title ?? `Test Learning ${index + 1}`,
    problemSpace: override.problemSpace ?? "Test problem space",
    insight: override.insight ?? "Test insight",
    blocks: override.blocks ?? [
      {
        blockType: "qa" as const,
        question: "Test question?",
        answer: "Test answer.",
      },
      {
        blockType: "why" as const,
        question: "Why is this true?",
        answer: "Because of reasons.",
      },
    ],
  }));
}
