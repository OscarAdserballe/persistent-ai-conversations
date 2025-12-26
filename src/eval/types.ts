/**
 * Eval types for experiment running
 */

import type { ContentBlock } from "../core/types";

/**
 * What the LLM returns (without embedding for JSON serialization in Langfuse)
 */
export interface LearningOutput {
  learningId: string;
  title: string;
  problemSpace: string;
  insight: string;
  blocks: ContentBlock[];
}

/**
 * Single experiment definition
 */
export interface ExperimentConfig {
  model: string;
  promptName: string;
}

/**
 * The experiments.json structure
 */
export interface EvalConfig {
  dataset: string;
  concurrency?: number;
  experiments: ExperimentConfig[];
}

/**
 * Result of running one experiment
 */
export interface ExperimentResult {
  runName: string;
  model: string;
  promptName: string;
  promptVersion: string;
  itemsProcessed: number;
  success: boolean;
  error?: string;
}

/**
 * Result of a single dataset item (returned to Langfuse)
 */
export interface ExperimentItemResult {
  conversationUuid: string;
  conversationTitle: string;
  learningsCount: number;
  learnings: LearningOutput[];
}

/**
 * Input structure expected in Langfuse dataset items
 */
export interface DatasetInput {
  conversationUuid: string;
  title?: string;
  context?: string;
}
