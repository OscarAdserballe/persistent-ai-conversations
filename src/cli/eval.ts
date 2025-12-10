#!/usr/bin/env node

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { parse as parseYaml } from "yaml";
import { loadConfig } from "../config";
import { createDatabase } from "../factories";
import { ExperimentRunner } from "../eval";
import type { EvalConfig } from "../eval";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function main() {
  try {
    // Load experiments.yaml from src/eval/
    const configPath = resolve(__dirname, "../eval/experiments.yaml");
    const evalConfig: EvalConfig = parseYaml(readFileSync(configPath, "utf-8"));

    // Validate
    if (!evalConfig.experiments?.length) {
      console.error("❌ No experiments defined in experiments.yaml");
      process.exitCode = 1;
      return;
    }

    // Load base config and database
    const config = loadConfig();
    const db = createDatabase(config.db.path);

    // Run experiments
    const runner = new ExperimentRunner(db, config);
    await runner.start();

    try {
      const results = await runner.runAll(evalConfig);
      const failedCount = results.filter((r) => !r.success).length;
      if (failedCount > 0) {
        process.exitCode = 1;
      }
    } finally {
      await runner.stop();
    }
  } catch (error) {
    console.error("❌ Eval failed:", error);
    process.exitCode = 1;
  }
}

main();
