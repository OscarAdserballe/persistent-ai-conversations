import type { LearningJSONType, FAQItemType } from "../schemas/learning";

type LearningOverride = Partial<Omit<LearningJSONType, "faq">> & {
  faq?: FAQItemType[];
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
    trigger: override.trigger ?? "Test trigger",
    insight: override.insight ?? "Test insight",
    why_points: override.why_points ?? ["Test reason 1", "Test reason 2"],
    faq: override.faq ?? [
      {
        question: "Test question?",
        answer: "Test answer.",
      },
    ],
  }));
}
