# Learning Extraction Prompt Improvements

## Problem

Current learnings are too generic. Example from NestJS caching conversation:

**Current (Generic)**:
- "Choosing between custom REQUEST scope and nestjs-cls for request-scoped caching"
- "NestJS TEST: `module.get()` vs `module.resolve()` for Scoped Providers"

**Should be (Personal)**:
- "I initially designed a REQUEST-scoped cache service but realized it forces the entire dependency graph to rebuild per request, which defeats the performance goal"
- "After benchmarking both approaches, I found nestjs-cls only saves 2.7% performance but the real win is avoiding `ContextIdFactory` boilerplate in every test file"

## Root Cause

The prompt doesn't ask the LLM to:
1. Track YOUR journey through the problem
2. Capture YOUR specific decisions and reasoning
3. Note what YOU tried and why YOU changed your mind
4. Record YOUR personal context and constraints

## Proposed Improvements

### 1. Add Persona/Voice Section

```
**CRITICAL: Write in first person from the perspective of the person having this conversation.**

This is YOUR learning journey. Write as "I" not "one should" or "developers should."

Examples:
- ❌ "Using REQUEST scope forces dependency graph rebuilding"
- ✅ "I learned that my REQUEST scope approach would rebuild the entire dependency graph per request, which defeats my performance optimization goal"

- ❌ "nestjs-cls provides better testing ergonomics"
- ✅ "I spent 4 hours researching this and concluded that avoiding `ContextIdFactory` boilerplate in tests is worth the 48kb dependency"
```

### 2. Add Journey Tracking

```
**Track the decision journey:**

- What did you initially think/try?
- What made you question that approach?
- What alternatives did you consider?
- What was the key realization that changed your mind?
- What trade-offs did you ultimately accept?

Example:
"I started by implementing REQUEST-scoped providers because it seemed like the 'pure NestJS' way. But after writing the implementation doc and running benchmarks, I realized the scope propagation forces ALL 9 services to be REQUEST-scoped, which means rebuilding the dependency graph on every request. The senior dev challenged me on whether I wasted time researching nestjs-cls, but the benchmarks showed only 2.7% performance difference - the real value is testing simplicity and avoiding architectural constraints."
```

### 3. Add Conversation-Specific Context

```
**Before extracting learnings, identify:**

1. What was the USER trying to accomplish? (their goal)
2. What problem were they solving? (the trigger)
3. What constraints did they have? (team, performance, existing code)
4. What alternatives did they explore? (the journey)
5. What was the final decision and why? (the resolution)

Then frame each learning in that specific context.
```

### 4. Require Specificity

```
**For each learning, include:**

- Specific numbers/data if mentioned (e.g., "2.7% faster", "90k downloads/week", "9 services")
- Specific tools/libraries/versions (e.g., "nestjs-cls", "AsyncLocalStorage", "REQUEST scope")
- Specific trade-offs accepted (e.g., "48kb dependency vs 500 LOC to maintain")
- Specific timeline/effort (e.g., "4 hours of research", "30-minute migration")

Generic learnings without these details should be rejected.
```

### 5. Capture Emotional/Social Context

```
**Include the human element:**

- Uncertainty: "I wasn't sure if..."
- Validation: "The senior dev questioned whether..."
- Realization: "The aha moment was when..."
- Confidence: "I'm now confident that..."
- Remaining doubts: "I still don't fully understand..."

Example:
"I was initially defensive about spending 4 hours researching instead of just implementing REQUEST scope. But after creating the decision justification doc with real benchmarks and ROI calculations, I realized the research was the right call - it saved the team from ongoing testing pain."
```

### 6. Link to Conversation Flow

```
**Reference the actual conversation flow:**

- "Early in the conversation, I thought..."
- "When you asked about X, I realized..."
- "The turning point was when you showed me..."
- "By the end, I understood that..."

This creates a narrative arc that makes the learning memorable.
```

## Revised Prompt Structure

```
You are extracting learnings from a conversation between a USER and an AI assistant.

**Step 1: Understand the Context**

Before extracting any learnings, analyze:
1. What was the USER trying to accomplish?
2. What was their initial approach?
3. What questions or challenges arose?
4. How did their understanding evolve?
5. What was the final decision/conclusion?

**Step 2: Extract Personal Learnings**

Write from the USER's first-person perspective ("I learned that...").

For each learning, capture:

**The Journey:**
- What I initially thought/tried
- What made me question that
- What alternatives I explored
- The key realization that changed my mind
- The trade-offs I ultimately accepted

**Specific Details:**
- Exact numbers, metrics, benchmarks mentioned
- Specific tools, libraries, versions discussed
- Concrete trade-offs (e.g., "48kb dependency vs 500 LOC")
- Timeline and effort invested

**The Human Element:**
- My uncertainties and doubts
- External challenges (e.g., "senior dev questioned...")
- Aha moments and breakthroughs
- Remaining gaps in understanding

**Actionable Implications:**
- When I'll use this approach vs alternatives
- What I'll watch out for
- How I'll explain this to others
- What I'll do differently next time

**Example of Good Learning:**

Title: "Why I chose nestjs-cls over REQUEST-scoped providers despite only 2.7% performance gain"

Context: "I was implementing request-scoped caching for our NestJS app to avoid duplicate embedding API calls (3-5 per request). Initially designed a REQUEST-scoped cache service following 'pure NestJS' patterns."

Insight: "After 4 hours of research and benchmarking, I learned that REQUEST scope forces the entire dependency graph (all 9 services) to rebuild per request, which ironically hurts the performance I'm trying to optimize. The real value of nestjs-cls isn't the 2.7% speed improvement - it's avoiding `ContextIdFactory` boilerplate in every test file and preventing scope propagation from constraining our architecture."

Why: "REQUEST-scoped providers trigger NestJS's dependency injection to recreate every service instance per request. This is expensive (2-3ms overhead) and forces ALL dependent services to also become REQUEST-scoped (scope propagation). nestjs-cls uses Node.js's built-in AsyncLocalStorage, which provides request isolation without rebuilding anything - services stay singleton."

Implications: "When implementing request-scoped features, I'll default to AsyncLocalStorage patterns (nestjs-cls) rather than REQUEST scope. I'll only use REQUEST scope if I genuinely need different service instances per request (rare). For the senior dev review, I'll lead with the testing complexity argument (no more `ContextIdFactory` in 10+ test files) and architectural flexibility (no forced scope propagation), not the small performance difference."

[Continue with full schema fields...]
```

## Testing the Improved Prompt

Run on the NestJS caching conversation and compare:

**Before:**
- Generic technical facts
- No personal journey
- Missing the "why I chose this" reasoning
- Lacks specific numbers and trade-offs

**After:**
- First-person narrative
- Clear decision journey
- Specific benchmarks and trade-offs
- Captures the senior dev challenge and response
- Notes the 4-hour research investment and ROI

## Implementation

1. Update `buildLearningExtractionPrompt()` in `src/services/learning-extractor.ts`
2. Add conversation analysis step before extraction
3. Require first-person voice in output validation
4. Test on 5-10 diverse conversations
5. Iterate based on results

