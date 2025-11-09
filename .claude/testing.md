# Testing Guidelines for LLM Archive

## Philosophy
- Every interface gets a test file
- Every test is independent (no shared state)
- Use fixtures, never real API calls
- Mock external dependencies (Gemini API, file system)
- Tests should run in < 5 seconds total

## When to Write Tests

### ALWAYS test before marking implementation complete:
1. After implementing any interface (EmbeddingModel, VectorStore, etc.)
2. After implementing any factory function
3. After implementing any CLI command
4. After fixing any bug

### Test Requirements by Component:

**EmbeddingModel implementations:**
- ✓ Returns correct dimensions
- ✓ Single embed() returns Float32Array of correct size
- ✓ embedBatch() returns array of correct length
- ✓ Handles rate limiting gracefully
- ✓ Retries on API errors
- ✓ Mock Gemini API (never real calls in tests)

**VectorStore implementations:**
- ✓ Throws if used before initialize()
- ✓ Throws if wrong dimensions passed
- ✓ insert() stores vectors
- ✓ search() returns results sorted by score
- ✓ Handles empty database
- ✓ Handles vector normalization

**ConversationImporter implementations:**
- ✓ Parses minimal.json fixture correctly
- ✓ Handles empty text messages
- ✓ Flattens content arrays
- ✓ Extracts attachment content
- ✓ Normalizes sender field
- ✓ Streams large files (test with multi-turn.json)

**SearchEngine implementations:**
- ✓ Mock EmbeddingModel (no real API)
- ✓ Mock VectorStore (use in-memory map)
- ✓ Returns results with context (previous/next messages)
- ✓ Applies filters (date, sender, conversation)
- ✓ Handles empty results
- ✓ Context window respects conversation boundaries

**Integration Tests:**
- ✓ Ingest minimal.json → verify DB contents
- ✓ Search for known query → verify expected results
- ✓ Re-ingest same data → UPSERT works (no duplicates)

**E2E Tests:**
- ✓ Full workflow: ingest → search → verify results match expectations
- ✓ Uses test fixtures only
- ✓ Temporary database (clean up after)

## How to Run Tests

```bash
npm test              # All tests
npm run test:unit     # Unit tests only
npm run test:integration  # Integration tests only
npm run test:e2e      # End-to-end tests
npm run test:watch    # Watch mode for development
npm run test:coverage # Run with coverage report
```

## Test Template

Every test file should follow this structure:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MockEmbeddingModel } from '../mocks/embedding-model'

describe('ComponentName', () => {
  // Setup
  beforeEach(() => {
    // Initialize test state
  })

  afterEach(() => {
    // Clean up
  })

  describe('methodName', () => {
    it('should handle normal case', () => {
      // Arrange
      const input = ...

      // Act
      const result = component.method(input)

      // Assert
      expect(result).toBe(expected)
    })

    it('should handle edge case: empty input', () => {
      // ...
    })

    it('should throw on invalid input', () => {
      expect(() => component.method(invalid)).toThrow()
    })
  })
})
```

## Mocking Strategy

**Create reusable mocks in `tests/mocks/`:**

```typescript
// tests/mocks/embedding-model.ts
export class MockEmbeddingModel implements EmbeddingModel {
  dimensions = 768

  async embed(text: string): Promise<Float32Array> {
    // Deterministic mock: hash text to consistent vector
    return new Float32Array(768).fill(text.length % 256)
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    return Promise.all(texts.map(t => this.embed(t)))
  }
}
```

## Agent Instructions

When asked to implement a feature:
1. **Read this testing.md file first**
2. **Implement the feature**
3. **Write tests according to guidelines above**
4. **Run tests: `npm test`**
5. **Fix any failures**
6. **Only mark task complete when all tests pass**

When asked to fix a bug:
1. **Write a failing test that reproduces the bug**
2. **Fix the bug**
3. **Verify test now passes**
4. **Run full test suite to ensure no regressions**

When asked to review code:
1. **Check if tests exist for all interfaces**
2. **Check if tests cover edge cases**
3. **Run tests and report coverage**

## Coverage Requirements

- Minimum 80% line coverage
- Minimum 80% function coverage
- Minimum 75% branch coverage

Run `npm run test:coverage` to check coverage levels.
