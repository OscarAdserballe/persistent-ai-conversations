## Learning Extraction Experiments (Langfuse + YAML Dataset)

### Dataset

- File: `data/eval/learning-extraction.dataset.yaml`
- Generated via:

```bash
yarn eval:generate
```

- Structure:

```yaml
experimentId: lex-001-baseline
promptVersion: v1

conversations:
  - conversationUuid: "0599f446-ebb7-4f26-a195-2b72ab123764"
    title: "Storing Claude conversations in a personal database"
    context: |-
      Conversation: "Storing Claude conversations in a personal database"
      Date: 2025-11-23T10:15:00.000Z

      [HUMAN]: ...

      [ASSISTANT]: ...
```

Edit this file if needed to:

- Change `experimentId` / `promptVersion`.
- Remove or reorder conversations.

### Syncing Dataset to Langfuse

After generating or updating the YAML dataset, sync it to Langfuse:

```bash
yarn eval:sync
```

This creates/updates the `evaluation/learning-extraction` dataset in Langfuse with all conversation entries from the YAML file.

### Running an Experiment

1. Ensure your `.env` and `config.json` are set up (db path, OpenRouter key, Langfuse keys, model id).
2. Ensure the dataset is synced to Langfuse (run `yarn eval:sync` if needed).
3. Run:

```bash
yarn eval
```

This uses the [Langfuse Experiments via SDK runner](https://langfuse.com/docs/evaluation/experiments/experiments-via-sdk) under the hood and will:

- Load the `evaluation/learning-extraction` dataset from Langfuse.
- Execute the runner’s task against each dataset item with built-in tracing and concurrency control.
- For every item:
  - Fetch the conversation from your local DB.
  - Delete existing learnings for that conversation (overwrite semantics).
  - Re-run the `LearningExtractor` with the current prompt/model.
  - Let Langfuse automatically capture the trace and **link it to the dataset run**, so you get native UI summaries instead of custom console logs.
- Tag the run with the `runName`, `model`, and `promptVersion` metadata and print the runner’s formatted summary (including the dataset-run URL) to the console.

### Prompt Source

- Both `yarn eval` and `yarn extract-learnings` now pull their system prompt from the Langfuse Prompt Library.
- The prompt name lives in `config.prompts.learningExtraction` (default: `smaller_schema`). Update that field to point at a different Langfuse prompt.
- There is no fallback—if the prompt does not exist in Langfuse the CLI will fail immediately, so make sure the prompt is created/published before running the command.

### Inspecting in Langfuse

In the Langfuse UI:

- Navigate to **Datasets → evaluation/learning-extraction**.
- Click on the **Runs** tab to see all experiment runs.
- Each run shows:
  - Run name (e.g. `lex-001-baseline`)
  - Model used
  - Latency, cost, and success metrics
  - Individual item traces with input/output
- Compare runs side-by-side to evaluate prompt/model changes.
- Add LLM-as-a-judge evaluators or human annotations to score runs.

Iteration loop:

1. Edit prompt in `src/services/learning-extractor.ts` or change model in `config.json`.
2. Run `yarn eval` with a new `runName` (edit in `run-langfuse-experiment.ts`).
3. Compare results in Langfuse **Datasets → Runs** view.
