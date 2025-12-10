# Changes Summary: Full Context in Langfuse Traces

## Problem Solved

Previously, when viewing traces in Langfuse, the Input field only showed metadata (`conversationUuid` and `title`) without the full conversation text. This made it impossible to iterate on prompts directly in the Langfuse Playground.

## Changes Made

### 1. Updated Experiment Runner (`src/cli/run-langfuse-experiment.ts`)

**Before:**
```typescript
const trace = langfuse.trace({
  input: {
    conversationUuid: fullConv.uuid,
    title: fullConv.title,
  },
  // ...
});
```

**After:**
```typescript
const trace = langfuse.trace({
  input: {
    conversationUuid: fullConv.uuid,
    title: fullConv.title,
    context: input.context, // ← Now includes full conversation text!
  },
  // ...
});
```

### 2. Updated Learning Extractor (`src/services/learning-extractor.ts`)

**Before:**
```typescript
const generation = options.langfuseTrace.generation({
  input: {
    conversationUuid: conversation.uuid,
    title: conversation.title,
  },
  // ...
});
```

**After:**
```typescript
const generation = options.langfuseTrace.generation({
  input: {
    prompt: prompt,           // ← Now includes the extraction prompt!
    context: context,         // ← Now includes full conversation text!
    conversationUuid: conversation.uuid,
    title: conversation.title,
  },
  // ...
});
```

## Result

Now when you view a trace in Langfuse:

1. **Trace-level Input** includes:
   - `conversationUuid`
   - `title`
   - `context` (full conversation text)

2. **Generation-level Input** includes:
   - `prompt` (the extraction prompt)
   - `context` (full conversation text)
   - `conversationUuid`
   - `title`

## How to Use in Langfuse Playground

### Method 1: From Trace

1. Open your experiment run in Langfuse
2. Click on a trace (e.g., "Nestjs service caching strategy")
3. Click on the "extract-learnings" generation span
4. Look at the "Input" tab - you'll now see:
   ```json
   {
     "prompt": "Extract learning moments from...",
     "context": "Conversation: \"Nestjs service caching strategy\"\n...",
     "conversationUuid": "...",
     "title": "..."
   }
   ```
5. Click **"Open in Playground"** button (top right)
6. Langfuse will create a playground session with:
   - The full prompt
   - The full context
   - The model used
7. **Edit the prompt** and iterate!

### Method 2: From Dataset Item

1. Go to **Datasets** → `evaluation/learning-extraction`
2. Click on a dataset item
3. The "Input" tab shows the full context
4. Click **"Open in Playground"**
5. Edit and iterate

## Testing the Changes

Run a new experiment to see the changes:

```bash
# Run experiment (will create new traces with full context)
yarn eval

# Then in Langfuse:
# 1. Go to the experiment run
# 2. Click any trace
# 3. Click the generation span
# 4. Input tab should now show full prompt + context
# 5. Click "Open in Playground" to iterate
```

## Benefits

✅ **No more copying context manually** - it's all in the trace
✅ **One-click to playground** - click "Open in Playground" from any trace
✅ **Full reproducibility** - every trace has complete input data
✅ **Easy prompt iteration** - edit prompt in playground, see results immediately
✅ **Better debugging** - can see exactly what was sent to the LLM

## Alternative: CLI Playground

If you prefer local iteration:

```bash
yarn playground <conversationUuid>
```

This gives you:
- Full conversation context
- Interactive prompt editing
- Immediate results
- No need to sync to Langfuse first

## Next Steps

1. **Run a new experiment**: `yarn eval`
2. **Check Langfuse UI**: Verify traces now have full context
3. **Try the playground**: Click "Open in Playground" from a generation span
4. **Iterate on prompt**: Test improvements to the extraction prompt
5. **Compare runs**: Use Langfuse to compare different prompt versions

