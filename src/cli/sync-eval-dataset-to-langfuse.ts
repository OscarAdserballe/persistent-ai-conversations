#!/usr/bin/env node

import { readFileSync } from "fs";
import { resolve } from "path";
import { parse } from "yaml";
import { LangfuseClient } from "@langfuse/client";
import { loadConfig } from "../config";

interface EvalConversationEntry {
  conversationUuid: string;
  title?: string;
  context?: string;
}

interface EvalDataset {
  experimentId: string;
  promptVersion?: string;
  conversations: EvalConversationEntry[];
}

async function main() {
  try {
    const datasetPath = resolve(
      process.cwd(),
      "data/eval/learning-extraction.dataset.yaml"
    );

    const yamlRaw = readFileSync(datasetPath, "utf-8");
    const dataset = parse(yamlRaw) as EvalDataset;

    if (
      !dataset ||
      !dataset.experimentId ||
      !Array.isArray(dataset.conversations)
    ) {
      throw new Error(
        `Invalid dataset format in ${datasetPath}. Expected keys: experimentId, conversations[].`
      );
    }

    const experimentId = dataset.experimentId;
    const promptVersion = dataset.promptVersion ?? "v1";

    const config = loadConfig();
    const modelId = config.llm.model;

    const langfuse = new LangfuseClient();
    const datasetName = "evaluation/learning-extraction";

    console.log(
      `🔗 Syncing YAML dataset to Langfuse dataset "${datasetName}" (experimentId=${experimentId}, promptVersion=${promptVersion})`
    );

    // Ensure dataset exists
    try {
      await langfuse.api.datasets.create({
        name: datasetName,
        description: "Learning extraction eval dataset",
        metadata: {
          experimentId,
          promptVersion,
        },
      });
      console.log(`✅ Created Langfuse dataset "${datasetName}"`);
    } catch (error: any) {
      // Ignore \"already exists\" style errors, log others
      const msg = String(error?.message ?? "");
      if (
        msg.toLowerCase().includes("already") &&
        msg.toLowerCase().includes("exist")
      ) {
        console.log(
          `ℹ️ Langfuse dataset "${datasetName}" already exists, reusing`
        );
      } else {
        console.warn(
          `⚠️ Could not create dataset "${datasetName}": ${msg} (attempting to continue)`
        );
      }
    }

    let successCount = 0;
    let failureCount = 0;

    for (let i = 0; i < dataset.conversations.length; i++) {
      const entry = dataset.conversations[i];

      const input = {
        conversationUuid: entry.conversationUuid,
        title: entry.title,
        context: entry.context,
      };

      const itemId = `${datasetName}:${entry.conversationUuid}`;

      try {
        await langfuse.api.datasetItems.create({
          datasetName,
          id: itemId,
          input,
          // No expectedOutput yet; we'll use this primarily for input benchmarking
          metadata: {
            experimentId,
            promptVersion,
            model: modelId,
          },
        });

        successCount++;
        console.log(
          `[${i + 1}/${
            dataset.conversations.length
          }] ✓ Upserted dataset item for "${
            entry.title ?? entry.conversationUuid
          }"`
        );
      } catch (error: any) {
        failureCount++;
        console.error(
          `[${i + 1}/${dataset.conversations.length}] ✗ Failed to sync "${
            entry.title ?? entry.conversationUuid
          }": ${error?.message ?? String(error)}`
        );
      }
    }

    console.log("\n=== Langfuse Dataset Sync Summary ===");
    console.log(`Dataset Name  : ${datasetName}`);
    console.log(`Items Total   : ${dataset.conversations.length}`);
    console.log(`Items Synced  : ${successCount}`);
    console.log(`Items Failed  : ${failureCount}`);
    console.log(
      "\nOpen Langfuse → Datasets → evaluation/learning-extraction to inspect and run Experiments."
    );

    process.exit(0);
  } catch (error: any) {
    console.error(
      `❌ Failed to sync eval dataset to Langfuse: ${
        error?.message ?? String(error)
      }`
    );
    process.exit(1);
  }
}

main();
