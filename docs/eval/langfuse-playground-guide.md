# Using Langfuse Playground for Prompt Iteration

## The Problem

When you look at a trace in Langfuse, the "Input" field only shows metadata like `conversationUuid` and `title`, not the full conversation text. But the full context IS there - it's just not immediately visible in the trace view.

## Where the Full Context Lives

The full conversation context is stored in the **Dataset Item's input field**. Here's how to access it:

### Method 1: Via Dataset Items (Recommended)

1. **Go to Datasets** → `evaluation/learning-extraction`
2. **Click on a dataset item** (e.g., "Nestjs service caching strategy")
3. **Look at the "Input" tab** - you'll see:
   ```json
   {
     "conversationUuid": "465d877a-4d1c-4a1a-9719-8c6dc62640d5",
     "title": "Nestjs service caching strategy",
     "context": "Conversation: \"Nestjs service caching strategy\"\nDate: 2025-10-28T10:51:16.305Z\n\n[HUMAN]: I have a bunch of services...\n\n[ASSISTANT]: ..."
   }
   ```
4. **Copy the full context** from the `context` field
5. **Go to Langfuse Playground** (top nav → Playground)
6. **Paste the context** into the "User Message" field
7. **Edit the system prompt** to test different extraction prompts
8. **Run and iterate!**

### Method 2: Via Trace (Less Convenient)

1. **Find your trace** in the experiment run
2. **Click on the generation span** (the LLM call)
3. **Look at "Input"** - it should have the full prompt + context
4. **Copy the relevant parts** to the playground

### Method 3: Direct Playground Link (Best for Iteration)

Langfuse has a feature to **create a playground session from a dataset item**:

1. Go to **Datasets** → `evaluation/learning-extraction`
2. Click on a dataset item
3. Look for the **"Open in Playground"** button (usually top right)
4. This creates a playground session pre-populated with:
   - The dataset item's input (including full context)
   - The model used
   - The prompt from the trace (if linked)

## Quick Workflow for Prompt Iteration

### Option A: Using Dataset Items

```
1. Datasets → evaluation/learning-extraction
2. Click item → "Open in Playground" (or copy input.context)
3. Playground → Edit system prompt
4. Run → See results
5. Iterate → Adjust prompt
6. Save prompt version when satisfied
```

### Option B: Using Our CLI (Faster)

```bash
# Get the conversation UUID from Langfuse
yarn playground 465d877a-4d1c-4a1a-9719-8c6dc62640d5

# Interactive menu:
# 1. View full context
# 2. Edit prompt
# 3. Run extraction
# 4. Iterate
```

## Why the Trace Input Looks Empty

When we run experiments, we create a trace with this structure:

```typescript
const trace = langfuse.trace({
  name: "learning-extraction",
  input: {
    conversationUuid: fullConv.uuid,
    title: fullConv.title,
    context: input.context,  // ← This IS included!
  },
  // ...
});
```

But Langfuse's UI might:
1. **Truncate long inputs** in the trace list view
2. **Only show metadata** in the preview
3. **Hide the full context** until you expand the generation span

The full context is definitely there - you just need to drill down to see it.

## Verifying Context is Synced

Run this to check what's actually in Langfuse:

```bash
# Re-sync to ensure latest data
yarn eval:sync

# Check the output - should show:
# ✓ Upserted dataset item for "Nestjs service caching strategy"
```

Then in Langfuse:
1. Datasets → evaluation/learning-extraction
2. Click any item
3. Input tab should show the full `context` field with all conversation text

## Recommended Iteration Flow

### For Quick Tests (Use CLI)
```bash
yarn playground <uuid>
```
- Fastest for rapid iteration
- Full control over prompt
- See results immediately
- No need to leave terminal

### For Formal Experiments (Use Langfuse)
```bash
# 1. Test prompt locally first
yarn playground <uuid>

# 2. Update prompt in code
# Edit src/services/learning-extractor.ts

# 3. Run full experiment
yarn eval

# 4. Review in Langfuse UI
# Compare runs, annotate, score
```

### For Prompt Versioning (Use Langfuse Prompts)

Langfuse has a **Prompt Management** feature:

1. **Prompts** (top nav) → Create new prompt
2. Name it `learning-extraction-v2`
3. Paste your improved prompt
4. **Version it** (v1, v2, v3...)
5. **Link to experiments** to track which prompt version was used

Then in code:
```typescript
// Fetch prompt from Langfuse instead of hardcoding
const prompt = await langfuse.getPrompt("learning-extraction-v2");
```

## Troubleshooting

### "I don't see the context field in the dataset item"

**Fix**: Re-run the sync
```bash
yarn eval:sync
```

This reads from `data/eval/learning-extraction.dataset.yaml` which DOES have the full context.

### "The context field is there but it's truncated"

**Fix**: Click "Expand" or "View Raw" in the Langfuse UI to see the full JSON.

### "I want to test on a conversation not in the dataset"

**Fix**: Use the CLI playground
```bash
yarn playground <any-conversation-uuid>
```

Or add it to the dataset:
```bash
# Edit data/eval/learning-extraction.dataset.yaml
# Add the conversation UUID
# Re-run sync
yarn eval:sync
```

## Best Practice: Hybrid Approach

1. **Rapid iteration**: Use CLI playground (`yarn playground`)
2. **Formal testing**: Run experiments (`yarn eval`)
3. **Analysis**: Use Langfuse UI to compare runs
4. **Versioning**: Store final prompts in Langfuse Prompts

This gives you:
- ✅ Fast local iteration (CLI)
- ✅ Centralized experiment tracking (Langfuse)
- ✅ Prompt versioning (Langfuse Prompts)
- ✅ Team collaboration (Langfuse UI)

## Next Steps

1. **Verify context is synced**: Check Datasets → evaluation/learning-extraction → any item → Input tab
2. **Try Langfuse Playground**: Copy context from dataset item, paste into playground
3. **Or use CLI**: `yarn playground 465d877a-4d1c-4a1a-9719-8c6dc62640d5` for faster iteration
4. **Iterate on prompt**: Test different versions
5. **Run experiment**: `yarn eval` when ready to test on full dataset

