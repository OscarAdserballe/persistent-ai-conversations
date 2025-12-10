# Telemetry Refactor: Using Vercel AI SDK's Built-in Langfuse Integration

## Problem

We were manually creating Langfuse traces and generation spans, which was:
1. **Verbose** - lots of boilerplate code
2. **Error-prone** - easy to forget to end spans or handle errors
3. **Not the recommended approach** - Vercel AI SDK has built-in telemetry support

## Solution

Use the Vercel AI SDK's `experimental_telemetry` option, which automatically:
- Creates traces in Langfuse
- Tracks generation spans
- Handles errors and timing
- Includes full input/output data

## Changes Made

### 1. Updated `LearningExtractorImpl` (`src/services/learning-extractor.ts`)

**Before:**
```typescript
if (options?.langfuseTrace) {
  const generation = options.langfuseTrace.generation({
    name: "extract-learnings",
    model: options.modelId || "unknown",
    input: { /* ... */ },
  });

  try {
    const { object } = await generateObject({
      model: this.model,
      schema: LearningsArraySchema,
      prompt: `${prompt}\n\n${context}`,
    });

    generation.end({ output: { learningsCount: object.length } });
    rawLearnings = object;
  } catch (error) {
    generation.end({ level: "ERROR", statusMessage: error.message });
    throw error;
  }
} else {
  // Duplicate code for non-traced runs
}
```

**After:**
```typescript
const { object } = await generateObject({
  model: this.model,
  schema: LearningsArraySchema,
  prompt: `${prompt}\n\n${context}`,
  experimental_telemetry: {
    isEnabled: true,
    functionId: "extract-learnings",
    metadata: {
      conversationUuid: conversation.uuid,
      title: conversation.title,
      experimentId: options?.experimentId,
      promptVersion: options?.promptVersion,
      // Include full context in metadata for Langfuse
      context: context,
      prompt: prompt,
    },
  },
});

const learnings = object;
```

**Benefits:**
- ✅ Single code path (no if/else)
- ✅ Automatic error handling
- ✅ Full input/output captured
- ✅ Proper timing and metadata
- ✅ Less code to maintain

### 2. Updated `LearningExtractionOptions` (`src/core/types.ts`)

**Before:**
```typescript
export interface LearningExtractionOptions {
  experimentId?: string;
  promptVersion?: string;
  modelId?: string;
  langfuseTrace?: any; // Langfuse trace object
}
```

**After:**
```typescript
export interface LearningExtractionOptions {
  experimentId?: string;
  promptVersion?: string;
  modelId?: string;
}
```

No need to pass Langfuse trace objects around - telemetry is automatic!

### 3. Simplified `createLearningExtractor` Factory (`src/factories/index.ts`)

**Before:**
```typescript
export function createLearningExtractor(
  config: Config,
  db?: DrizzleDB,
  langfuse?: LangfuseClient
): LearningExtractor {
  // ...
  return new LearningExtractorImpl(llm, embedder, database, langfuse);
}
```

**After:**
```typescript
export function createLearningExtractor(
  config: Config,
  db?: DrizzleDB
): LearningExtractor {
  // ...
  return new LearningExtractorImpl(llm, embedder, database);
}
```

No need to pass Langfuse client - telemetry is handled by the AI SDK!

### 4. Simplified Experiment Runner (`src/cli/run-langfuse-experiment.ts`)

**Before:**
```typescript
const langfuse = new Langfuse();
const extractor = createLearningExtractor(config, db, langfuse);

// Create manual trace
const trace = langfuse.trace({
  id: `${runName}-${fullConv.uuid}`,
  name: "learning-extraction",
  input: { /* ... */ },
});

// Pass trace to extractor
const learnings = await extractor.extractFromConversation(fullConv, {
  experimentId: runName,
  langfuseTrace: trace,
});

// Update trace
trace.update({ output: { /* ... */ } });

// Link to dataset
await item.link(trace, runName);
```

**After:**
```typescript
const extractor = createLearningExtractor(config, db);

// Just run extraction - telemetry is automatic!
const learnings = await extractor.extractFromConversation(fullConv, {
  experimentId: runName,
  promptVersion: "v1",
  modelId: config.llm.model,
});
```

**Much simpler!** The Vercel AI SDK handles all the tracing automatically.

## How It Works

### Vercel AI SDK + Langfuse Integration

When you call `generateObject` with `experimental_telemetry: { isEnabled: true }`:

1. **AI SDK detects Langfuse** via environment variables:
   ```bash
   LANGFUSE_PUBLIC_KEY=pk-...
   LANGFUSE_SECRET_KEY=sk-...
   LANGFUSE_BASE_URL=https://cloud.langfuse.com
   ```

2. **Automatically creates a trace** with:
   - Unique trace ID
   - Start/end timestamps
   - Full input (prompt + context)
   - Full output (generated object)
   - Model information
   - Token usage
   - Latency

3. **Includes metadata** from `experimental_telemetry.metadata`:
   - `conversationUuid`
   - `title`
   - `experimentId`
   - `promptVersion`
   - `context` (full conversation)
   - `prompt` (extraction prompt)

4. **Handles errors** automatically:
   - If `generateObject` throws, the trace is marked as error
   - Error message and stack trace are captured
   - No need for manual error handling

## What You'll See in Langfuse

After running `yarn eval`, each extraction will create a trace with:

### Trace-level Data
- **Name**: `extract-learnings` (from `functionId`)
- **Input**: Full prompt + context (from `metadata`)
- **Output**: Generated learnings array
- **Metadata**: 
  - `conversationUuid`
  - `title`
  - `experimentId`
  - `promptVersion`
  - `context` (full conversation text)
  - `prompt` (extraction prompt)

### Generation-level Data
- **Model**: `google/gemini-2.5-flash-lite`
- **Latency**: Actual generation time
- **Tokens**: Input/output token counts
- **Cost**: Estimated cost (if Langfuse has pricing data)

## Benefits of This Approach

### 1. **Less Code**
- Removed ~50 lines of manual trace management
- Single code path (no if/else for traced vs non-traced)
- No manual error handling for traces

### 2. **More Reliable**
- AI SDK handles all edge cases
- Automatic error capture
- Proper timing and token tracking
- No risk of forgetting to end spans

### 3. **Better Data**
- Full input/output automatically captured
- Token usage and cost tracking
- Proper parent-child span relationships
- Consistent metadata structure

### 4. **Easier to Use**
- No need to pass Langfuse clients around
- No need to manage trace lifecycle
- Just enable telemetry and it works

### 5. **Future-Proof**
- When `experimental_telemetry` becomes stable, we just remove the prefix
- AI SDK will add more features over time
- Works with other observability tools (OpenTelemetry, etc.)

## Testing

Run an experiment to see the new telemetry in action:

```bash
# Ensure environment variables are set
export LANGFUSE_PUBLIC_KEY=pk-...
export LANGFUSE_SECRET_KEY=sk-...
export LANGFUSE_BASE_URL=https://cloud.langfuse.com

# Run experiment
yarn eval

# Check Langfuse UI:
# 1. Go to Traces
# 2. Look for traces with name "extract-learnings"
# 3. Click on a trace
# 4. You should see:
#    - Full prompt + context in metadata
#    - Generated learnings in output
#    - Proper timing and token usage
#    - All metadata fields (experimentId, promptVersion, etc.)
```

## Iterating on Prompts in Langfuse

With the new telemetry approach, you can iterate on prompts directly in Langfuse:

1. **Find a trace** in the Langfuse UI
2. **Click on the generation span**
3. **Look at metadata** - you'll see:
   - `prompt`: The full extraction prompt
   - `context`: The full conversation text
4. **Click "Open in Playground"**
5. **Edit the prompt** and test different versions
6. **Compare results** across different prompt versions

The full context is now always available in the trace metadata, making it easy to iterate!

## Migration Notes

### For Existing Code

If you have other code that calls `extractFromConversation`:

**Before:**
```typescript
const langfuse = new Langfuse();
const trace = langfuse.trace({ /* ... */ });
const learnings = await extractor.extractFromConversation(conv, {
  langfuseTrace: trace,
});
```

**After:**
```typescript
// Just remove the langfuseTrace option - telemetry is automatic!
const learnings = await extractor.extractFromConversation(conv, {
  experimentId: "my-experiment",
  promptVersion: "v1",
});
```

### For Tests

Tests don't need to change - telemetry is only enabled when environment variables are set. In test environments without Langfuse credentials, telemetry is automatically disabled.

## References

- [Vercel AI SDK Telemetry Docs](https://sdk.vercel.ai/docs/ai-sdk-core/telemetry)
- [Langfuse Integration Guide](https://langfuse.com/docs/integrations/vercel-ai-sdk)
- [OpenTelemetry Specification](https://opentelemetry.io/docs/specs/otel/)

## Summary

✅ **Simpler code** - removed manual trace management
✅ **More reliable** - automatic error handling and timing
✅ **Better data** - full input/output, tokens, cost
✅ **Easier to use** - just enable telemetry
✅ **Future-proof** - follows AI SDK best practices

The refactor makes our telemetry integration more maintainable and aligns with the recommended approach from the Vercel AI SDK team.

