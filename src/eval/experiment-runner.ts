import { NodeSDK } from "@opentelemetry/sdk-node";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import { LangfuseClient, type ExperimentTask } from "@langfuse/client";
import type { Config } from "../core/types";
import { DrizzleDB } from "../db/client";
import { LearningExtractorImpl } from "../services/learning-extractor";
import { createEmbeddingModel } from "../factories";
import { getModel } from "../llm/client";
import { getConversationByUuid } from "../api/conversations";
import { deleteLearningsByConversation } from "../api/learnings";
import type {
  EvalConfig,
  ExperimentConfig,
  ExperimentResult,
  ExperimentItemResult,
  LearningOutput,
  DatasetInput,
} from "./types";

/**
 * Core service for running Langfuse experiments.
 * Handles single and batch experiment runs with proper OTel tracing.
 */
export class ExperimentRunner {
  private langfuse: LangfuseClient | null = null;
  private otelSdk: NodeSDK | null = null;

  constructor(private db: DrizzleDB, private baseConfig: Config) {}

  /**
   * Initialize OpenTelemetry and Langfuse clients.
   * Must be called before running experiments.
   */
  async start(): Promise<void> {
    this.otelSdk = new NodeSDK({
      spanProcessors: [new LangfuseSpanProcessor()],
    });
    await this.otelSdk.start();
    this.langfuse = new LangfuseClient();
  }

  /**
   * Cleanup OpenTelemetry and flush Langfuse.
   * Must be called after experiments complete.
   */
  async stop(): Promise<void> {
    if (this.langfuse) {
      await this.langfuse
        .flush()
        .catch((err) => console.error("Langfuse flush failed:", err));
    }
    if (this.otelSdk) {
      await this.otelSdk
        .shutdown()
        .catch((err) => console.error("OpenTelemetry shutdown failed:", err));
    }
  }

  /**
   * Run all experiments from config in parallel.
   */
  async runAll(config: EvalConfig): Promise<ExperimentResult[]> {
    if (!this.langfuse) {
      throw new Error("ExperimentRunner not started. Call start() first.");
    }

    console.log(`🔬 Running ${config.experiments.length} experiments\n`);
    console.log(`Dataset: ${config.dataset}`);
    console.log(`Concurrency: ${config.concurrency ?? 10}\n`);

    const results = await Promise.all(
      config.experiments.map((exp) =>
        this.runSingle(exp, config.dataset, config.concurrency ?? 10)
      )
    );

    // Summary
    const successful = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);

    console.log(
      `\n✅ ${successful.length}/${results.length} experiments complete.`
    );
    if (failed.length > 0) {
      console.log(`❌ ${failed.length} failed:`);
      failed.forEach((r) => console.log(`   - ${r.model}: ${r.error}`));
    }
    console.log("\nView results in Langfuse dashboard.");

    return results;
  }

  /**
   * Run a single experiment with specified model and prompt.
   */
  private async runSingle(
    exp: ExperimentConfig,
    datasetName: string,
    concurrency: number
  ): Promise<ExperimentResult> {
    const { model, promptName } = exp;
    const modelShortName = this.getModelShortName(model);

    try {
      const { text: promptTemplate, version: promptVersion } =
        await this.getPromptWithVersion(promptName);

      const runName = `${promptName}-${promptVersion}-${modelShortName}`;
      console.log(`  Starting: ${runName}`);

      const dataset = await this.langfuse!.dataset.get(datasetName);
      if (!dataset.items.length) {
        throw new Error(`Dataset "${datasetName}" has no items.`);
      }

      // Create extractor for this model
      const llm = getModel(model);
      const embedder = createEmbeddingModel(this.baseConfig);
      const extractor = new LearningExtractorImpl(
        llm,
        embedder,
        this.db,
        promptTemplate
      );

      // Build the task
      const task: ExperimentTask = async (item) => {
        const input = item.input as DatasetInput;
        if (!input?.conversationUuid) {
          throw new Error("Dataset item missing conversationUuid");
        }

        const conversation = getConversationByUuid(
          this.db,
          input.conversationUuid
        );
        deleteLearningsByConversation(this.db, conversation.uuid);

        const learnings = await extractor.extractFromConversation(
          conversation,
          {
            experimentId: runName,
            promptVersion,
            modelId: model,
          }
        );

        const learningsOutput: LearningOutput[] = learnings.map((l) => ({
          learningId: l.learningId,
          title: l.title,
          trigger: l.trigger,
          insight: l.insight,
          whyPoints: l.whyPoints,
          faq: l.faq,
        }));

        return {
          conversationUuid: conversation.uuid,
          conversationTitle: conversation.title,
          learningsCount: learnings.length,
          learnings: learningsOutput,
        } as ExperimentItemResult;
      };

      await dataset.runExperiment({
        name: runName,
        runName,
        description: `${promptName} with ${modelShortName}`,
        metadata: { model, modelShortName, promptName, promptVersion },
        task,
        maxConcurrency: concurrency,
      });

      console.log(`  ✓ ${runName} (${dataset.items.length} items)`);

      return {
        runName,
        model,
        promptName,
        promptVersion,
        itemsProcessed: dataset.items.length,
        success: true,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(`  ✗ ${promptName}-${modelShortName}: ${errorMessage}`);

      return {
        runName: `${promptName}-unknown-${modelShortName}`,
        model,
        promptName,
        promptVersion: "unknown",
        itemsProcessed: 0,
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Fetch prompt from Langfuse with version info.
   */
  private async getPromptWithVersion(
    promptName: string
  ): Promise<{ text: string; version: string }> {
    const promptClient = await this.langfuse!.prompt.get(promptName);
    const text = (promptClient as { prompt?: string }).prompt;
    const version = (promptClient as { version?: number }).version;

    if (!text) {
      throw new Error(`Prompt "${promptName}" returned no content.`);
    }

    return {
      text,
      version: version !== undefined ? `v${version}` : "v1",
    };
  }

  /**
   * Extract short model name from OpenRouter ID.
   * @example "anthropic/claude-opus-4.5" -> "claude-opus-4.5"
   */
  private getModelShortName(modelId: string): string {
    return modelId.split("/").pop() || modelId;
  }
}


