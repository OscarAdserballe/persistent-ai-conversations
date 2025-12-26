import type { LearningSearch, Learning } from "../../src/core/types.js";
import { generateText, type LanguageModel } from "ai";

/**
 * Options for explaining a new concept
 */
export interface ExplainOptions {
  /**
   * Number of related learnings to retrieve.
   * Default: 7 (sweet spot for context without overwhelming LLM)
   */
  learningLimit?: number;

  /**
   * Override LLM temperature for synthesis.
   * Lower = more focused, Higher = more creative
   * Default: uses config value
   */
  temperature?: number;

  /**
   * Custom prompt to use instead of default synthesis prompt.
   * Allows users to customize explanation style.
   */
  customPrompt?: string;
}

/**
 * Result from isomorphism engine explanation
 */
export interface IsomorphismResult {
  /** The original concept that was queried */
  newConcept: string;

  /** Related learnings retrieved from database */
  relatedLearnings: Learning[];

  /** LLM-generated bridge explanation */
  synthesis: string;

  /** Key insights extracted from learnings (for display) */
  insights: string[];

  /** Confidence score (0-1) based on similarity scores */
  confidence: number;

  /** Timestamp of when this explanation was generated */
  timestamp: Date;
}

/**
 * Orchestrates learning search and LLM synthesis to bridge
 * unknown concepts with known learnings.
 *
 * This is a DISPOSABLE service for validation.
 * When migrating to T3, extract the prompt strategy and
 * rebuild with tRPC.
 */
export interface IsomorphismEngine {
  /**
   * Explain a new concept using similar past learnings.
   *
   * @param newConcept - The confusing concept to explain
   * @param options - Search and synthesis options
   * @returns Synthesis result with related learnings
   */
  explain(
    newConcept: string,
    options?: ExplainOptions
  ): Promise<IsomorphismResult>;
}

/**
 * Implementation of IsomorphismEngine
 */
export class IsomorphismEngineImpl implements IsomorphismEngine {
  constructor(
    private learningSearch: LearningSearch,
    private llm: LanguageModel
  ) {}

  async explain(
    newConcept: string,
    options?: ExplainOptions
  ): Promise<IsomorphismResult> {
    const limit = options?.learningLimit || 7;

    // Step 1: Search for structurally similar learnings
    const searchResults = await this.learningSearch.search(newConcept, {
      limit,
    });

    if (searchResults.length === 0) {
      return {
        newConcept,
        relatedLearnings: [],
        synthesis:
          "No related learnings found. This might be entirely new territory!",
        insights: [],
        confidence: 0,
        timestamp: new Date(),
      };
    }

    const learnings = searchResults.map((r) => r.learning);
    const scores = searchResults.map((r) => r.score);

    // Step 2: Build synthesis context
    const context = this.buildSynthesisContext(newConcept, learnings);

    // Step 3: Generate synthesis using LLM
    const prompt = options?.customPrompt || this.buildSynthesisPrompt();
    const { text: synthesis } = await generateText({
      model: this.llm,
      prompt: `${prompt}\n\n${context}`,
    });

    // Step 4: Extract insights for display
    const insights = this.extractInsights(learnings);

    // Step 5: Calculate confidence
    const confidence = this.calculateConfidence(scores);

    return {
      newConcept,
      relatedLearnings: learnings,
      synthesis,
      insights,
      confidence,
      timestamp: new Date(),
    };
  }

  private buildSynthesisContext(
    newConcept: string,
    learnings: Learning[]
  ): string {
    let context = `NEW CONCEPT TO EXPLAIN:\n${newConcept}\n\n`;
    context += `RELATED LEARNINGS FROM YOUR PAST:\n\n`;

    learnings.forEach((learning, i) => {
      context += `[Learning ${i + 1}] ${learning.title}\n`;
      context += `Problem Space: ${learning.problemSpace}\n`;
      context += `Insight: ${learning.insight}\n`;

      // Include blocks (Q&A pairs)
      if (learning.blocks && learning.blocks.length > 0) {
        context += `Key Points:\n`;
        learning.blocks.forEach((block) => {
          context += `  [${block.blockType}] Q: ${block.question}\n`;
          context += `           A: ${block.answer}\n`;
        });
      }

      context += `\n`;
    });

    return context;
  }

  private buildSynthesisPrompt(): string {
    return `
You are an Isomorphism Engine. Your goal is NOT to explain the new concept from scratch,
but to "translate" it into concepts the user already knows.

INSTRUCTIONS:
1. Analyze the NEW CONCEPT the user is confused about.
2. Scan the RELATED LEARNINGS for structural/logical similarities.
   - Look for matching PATTERNS, not just matching keywords.
   - Example: "Go Channels" (new) ≈ "Redux Sagas" (old) because both handle async streams.
3. Generate a bridge explanation:
   - Start with: "This is structurally similar to [Known Concept] which you learned about..."
   - Explain the NEW concept using the OLD concept as a metaphor/analogy.
   - Be specific about what maps to what: "X in the new concept is like Y in your past learning."
4. If multiple learnings are relevant, weave them together to build understanding.

CRITICAL GUIDELINES:
- Focus on STRUCTURE and PATTERNS, not surface-level similarities.
- Be explicit about the mapping: "A does X, which is like how B did Y."
- Avoid generic explanations - leverage the specific learnings provided.
- If truly nothing matches, admit it: "This seems genuinely new - no strong analogies found."

Return your explanation as plain text (not JSON).
`.trim();
  }

  private extractInsights(learnings: Learning[]): string[] {
    const insights = new Set<string>();

    for (const learning of learnings) {
      // Extract key insight from each learning
      if (learning.insight) {
        // Take first sentence or first 100 chars
        const shortInsight = learning.insight.split(".")[0];
        if (shortInsight.length > 0) {
          insights.add(shortInsight);
        }
      }
    }

    return Array.from(insights).slice(0, 5); // Limit to 5 insights
  }

  private calculateConfidence(scores: number[]): number {
    if (scores.length === 0) return 0;

    // Confidence based on top match score and average of top 3
    const topScore = scores[0];
    const top3Avg =
      scores.slice(0, 3).reduce((a, b) => a + b, 0) /
      Math.min(3, scores.length);

    // Weighted: 60% top match, 40% top 3 average
    return topScore * 0.6 + top3Avg * 0.4;
  }
}
