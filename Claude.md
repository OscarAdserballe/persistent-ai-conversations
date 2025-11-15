# Claude.md - Development Guidelines

## Golden Rule

**Before implementing any new feature:**

1. ✅ Read ALL documentation in `/docs/` directory
2. ✅ Create a new numbered architecture document (e.g., `docs/2. FEATURE_NAME.md`)
3. ✅ Get architectural design approved
4. ✅ **Write/update tests FIRST** (or alongside implementation)
5. ✅ Implement the feature
6. ✅ **Run `npm test` and fix ALL failures before considering the feature "done"**

**Never code without documentation first.** This ensures architectural consistency and makes the codebase maintainable.

**Never consider a feature complete without passing tests.** Tests are the contract that ensures your implementation works correctly.

---

## Documentation Standards

### Structure

Follow the pattern established in `docs/0. BASIC IMPLEMENTATION.md`:

1. **Overview** - How this feature extends existing functionality
2. **High-level Integration View** - Single diagram showing where new components fit
3. **Detailed Flow Diagrams** - Focus on NEW flows, reference existing ones
4. **Interfaces** - Document new interfaces, reference existing ones
5. **Implementation Classes** - Concrete implementations
6. **Factory Extensions** - How to wire up with DI
7. **CLI Commands** - User-facing commands
8. **Configuration** - New config sections
9. **Integration Summary** - What's reused vs. what's new
10. **File Structure** - Where new code lives
11. **Implementation Checklist** - Phased approach

### Key Principles

- **Assume readers have context:** Reference existing docs, don't duplicate
- **Zoom into new components:** High-level overview → detailed new flows
- **Use Mermaid diagrams:** Visual architecture is critical
- **Show integration points:** Clearly mark what's reused vs. new
- **Provide code examples:** Interface definitions and key classes

---

## Architecture Principles

### 1. Interface-First Design

**Always define interfaces before implementations.**

```typescript
// ✅ Good: Define interface in types.ts
interface FeatureService {
  doThing(input: string): Promise<Output>;
}

// Then implement
class FeatureServiceImpl implements FeatureService {
  // ...
}
```

**Why:** Enables testing, clear contracts, easy swapping of implementations.

### 2. Factory Pattern + Constructor Injection

**All dependencies injected via constructors, wired by factories.**

```typescript
// ✅ Good: Constructor injection
class MyService implements ServiceInterface {
  constructor(
    private dependency1: Dependency1,
    private dependency2: Dependency2,
    private db: Database
  ) {}
}

// Factory wires everything
function createMyService(config: Config): ServiceInterface {
  const dep1 = createDependency1(config);
  const dep2 = createDependency2(config);
  const db = new Database(config.db.path);

  return new MyService(dep1, dep2, db);
}
```

**Why:** Clear dependencies, testable (mock dependencies), no hidden globals.

### 3. Extend, Don't Modify

**When adding features, prefer extending over modifying existing code.**

- ✅ Create new tables that link to existing ones (via foreign keys)
- ✅ Create new services that read from existing data
- ✅ Add new CLI commands that use existing factories
- ❌ Don't modify existing database schema if avoidable
- ❌ Don't change existing interface signatures (breaking changes)

**Example:** Learning extraction reads conversations (existing) but stores learnings (new table) with foreign keys back to conversations.

### 4. Reuse Infrastructure

**Don't reinvent the wheel. Reuse existing patterns and services.**

Examples:

- Need embeddings? → Reuse `GeminiEmbedding` via factory
- Need vector search? → Reuse `SqliteVectorStore` patterns
- Need database access? → Follow existing prepared statement patterns
- Need CLI commands? → Follow existing commander.js patterns

### 5. Configuration Over Hard-coding

**All external dependencies and tunable parameters go in config.json.**

```typescript
// ❌ Bad: Hard-coded
const API_KEY = "abc123";
const BATCH_SIZE = 100;

// ✅ Good: Configured
interface Config {
  apiKey: string;
  batchSize: number;
}
```

### 6. Transparent Data Structures

**Use clear, platform-agnostic data structures throughout the system.**

```typescript
// ✅ Good: Clear interface
interface Message {
  uuid: string;
  conversationUuid: string;
  sender: "human" | "assistant";
  text: string;
  createdAt: Date;
}

// Not: ClaudeMessage with nested content arrays
```

**Why:** Makes system extensible to multiple platforms (OpenAI, Anthropic, etc.).

---

## Code Organization

### Directory Structure

```
src/
├── core/
│   └── types.ts              # ALL interfaces and types
├── [feature]/                # One directory per major service area
│   └── implementation.ts     # Concrete implementations
├── factories/
│   └── index.ts              # DI wiring
├── cli/
│   └── commands.ts           # User-facing CLI
└── config.ts                 # Config loading
```

**Rules:**

- All interfaces in `core/types.ts` (single source of truth)
- Implementations in feature-specific directories
- Factory functions in `factories/index.ts`
- CLI commands in `cli/`

### Naming Conventions

- **Interfaces:** `EmbeddingModel`, `SearchEngine` (no "I" prefix)
- **Implementations:** `GeminiEmbedding`, `SemanticSearch` (concrete name)
- **Factories:** `createEmbeddingModel()`, `createSearchEngine()` (verb + noun)
- **Config interfaces:** `EmbeddingConfig`, `SearchConfig` (noun + Config)

---

## Testing Philosophy

### 🚨 CRITICAL: Tests Are Non-Negotiable

**Tests are not optional. They are the contract that ensures your code works.**

- ❌ **NEVER** consider a feature complete without passing tests
- ❌ **NEVER** commit code with failing tests
- ❌ **NEVER** skip running `npm test` after making changes
- ✅ **ALWAYS** run `npm test` before AND after implementing features
- ✅ **ALWAYS** fix ALL test failures immediately
- ✅ **ALWAYS** write tests for new features as you build them

### Test-Driven Development Workflow

**For every feature you implement, follow this workflow:**

1. **Before coding:** Run `npm test` to ensure baseline passes
2. **While coding:** Write tests alongside implementation (or write tests first!)
3. **After coding:** Run `npm test` and fix ALL failures
4. **Before committing:** Run `npm test` one final time

**Example workflow:**

```bash
# Step 1: Verify baseline
npm test  # Should pass (235/235)

# Step 2: Implement feature + write tests
# ... code and test files ...

# Step 3: Run tests frequently during development - it's never "someone else's" problem
npm test  # Fix any failures immediately

# Step 4: Final check before commit
npm test  # Must pass 100% before commit
```

### What to Test

1. **Unit tests:** Core logic with mocked dependencies
2. **Integration tests:** End-to-end flows with real database (in-memory)
3. **E2E tests:** Full CLI workflows with real files and databases
4. **Edge cases:** Empty inputs, malformed data, API failures, boundary conditions

### How to Test

```typescript
// ✅ Good: Mock dependencies via interfaces
const mockEmbedder: EmbeddingModel = {
  embed: async (text) => new Float32Array(768),
  embedBatch: async (texts) => texts.map(() => new Float32Array(768)),
  dimensions: 768,
};

const service = new MyService(mockEmbedder, mockDb);
```

**Why:** Interface-based design makes mocking trivial.

### Common Test Failure Patterns

When tests fail after implementing a feature, check:

1. **Missing interface methods** - Did you add a method to an interface but not implement it in mocks?
2. **Type mismatches** - Are database column names (snake_case) properly aliased to TypeScript properties (camelCase)?
3. **Optional parameters** - Did you make a parameter required in the interface but call it without that parameter in tests?
4. **Mock data structure** - Do mocks return data in the same format as real implementations?
5. **Deprecated methods** - Did you remove/deprecate a method that tests still call?

### Test Organization

- **`tests/unit/`** - Fast tests with mocked dependencies (< 50ms each)
- **`tests/integration/`** - Tests with real database but mocked external APIs (< 500ms each)
- **`tests/e2e/`** - Full workflow tests with CLI commands (< 5s each)
- **`tests/mocks/`** - Reusable mock implementations

### Writing Good Tests

Always test interfaces rather than implementations! Test should not need to know very much about the implementation of an

```typescript
// ✅ Good: Clear test name, arrange-act-assert pattern
it("should return empty array when no learnings exist", async () => {
  // Arrange: Set up test data
  const search = new LearningSearchImpl(embedder, vectorStore, db);

  // Act: Execute the function
  const results = await search.search("test query");

  // Assert: Verify expectations
  expect(results).toEqual([]);
});

// ❌ Bad: Vague name, unclear expectations
it("works", async () => {
  const results = await search.search("test");
  expect(results).toBeDefined();
});
```

---

## CLI Design Patterns

### Commander.js Structure

```typescript
import { Command } from "commander";

const program = new Command();

program
  .name("my-command")
  .description("What this command does")
  .argument("<required>", "Required argument description")
  .option("-o, --optional <value>", "Optional flag", "default")
  .action(async (required, options) => {
    // Implementation
  });

program.parse();
```

### Error Handling

```typescript
// ✅ Good: User-friendly errors
try {
  await extractor.extract();
} catch (error) {
  console.error(`❌ Extraction failed: ${error.message}`);
  console.error(`\nTroubleshooting:`);
  console.error(`  - Check your API key in config.json`);
  console.error(`  - Ensure database exists: ${config.db.path}`);
  process.exit(1);
}
```

### Progress Logging

```typescript
// ✅ Good: Show progress
console.log(`Processing ${total} items...`);

for (let i = 0; i < items.length; i++) {
  await processItem(items[i]);

  if ((i + 1) % 10 === 0) {
    console.log(`  Processed ${i + 1}/${total}...`);
  }
}

console.log(`✓ Complete!`);
```

---

## Database Patterns

### Schema Design

1. **Use foreign keys** to maintain referential integrity
2. **Use indexes** on frequently-queried columns
3. **Use DATETIME** for timestamps (ISO format)
4. **Use CHECK constraints** for enums

```sql
CREATE TABLE example (
  id INTEGER PRIMARY KEY,
  status TEXT CHECK(status IN ('pending', 'complete')),
  created_at DATETIME NOT NULL,
  parent_id INTEGER,

  FOREIGN KEY (parent_id) REFERENCES parents(id) ON DELETE CASCADE
);

CREATE INDEX idx_example_status ON example(status);
CREATE INDEX idx_example_created ON example(created_at);
```

### Query Patterns

```typescript
// ✅ Good: Prepared statements
const stmt = db.prepare(`
  SELECT * FROM table
  WHERE column = ?
`);
const results = stmt.all(value);

// ✅ Good: Transactions for multiple inserts
const insertMany = db.transaction((items) => {
  const stmt = db.prepare("INSERT INTO table VALUES (?)");
  for (const item of items) {
    stmt.run(item);
  }
});

insertMany(items);
```

---

## Prompt Engineering (for LLM Features)

### Effective Prompts

1. **Be explicit about output format:** "Return JSON array: [{...}]"
2. **Provide examples:** Show exactly what good output looks like
3. **Define constraints:** "Max 100 chars", "2-3 sentences"
4. **Allow empty results:** "Return [] if no results"
5. **Iterate based on results:** Refine prompt based on quality

```typescript
const GOOD_PROMPT = `
Analyze this conversation and extract learnings.

Return a JSON array. If no learnings, return [].

Each learning must have:
- title: Brief description (max 100 chars)
- content: Detailed explanation (2-3 sentences)

Example:
[
  {
    "title": "Database Indexing Strategy",
    "content": "Learned that composite indexes should be ordered..."
  }
]

Conversation:
`.trim();
```

---

## Git Workflow

### Commit Messages

Follow conventional commits:

```
feat(learnings): add learning extraction service
fix(search): handle empty query strings
docs: add learnings architecture document
refactor(db): extract vector search logic
test(import): add edge case for empty messages
```

### Branch Strategy

- `main` - Stable, working code
- `feature/feature-name` - New features
- `fix/bug-description` - Bug fixes

---

## When to Add Documentation

### Create new docs when:

- ✅ Adding a major feature (new service, new data model)
- ✅ Introducing new architectural patterns
- ✅ Adding external integrations (new APIs)

### Update existing docs when:

- ✅ Modifying interfaces or contracts
- ✅ Changing database schema
- ✅ Updating configuration structure

### Inline comments when:

- ✅ Complex algorithms or logic
- ✅ Non-obvious workarounds
- ✅ Performance optimizations

---

## Example: Adding a New Feature

**Scenario:** Add support for OpenAI embeddings

### Step 1: Read Docs

```bash
cat docs/0. BASIC IMPLEMENTATION.md
# Understand existing EmbeddingModel interface
# See how GeminiEmbedding implements it
```

### Step 2: Create Architecture Doc

```bash
touch "docs/2. OPENAI EMBEDDINGS.md"
```

Contents:

- How OpenAI embeddings extend existing system
- OpenAIEmbedding class implementing EmbeddingModel
- Configuration changes needed
- Factory modifications

### Step 3: Get Approval

- Share `docs/2. OPENAI EMBEDDINGS.md`
- Get feedback on architecture
- Refine design

### Step 4: Verify Baseline

```bash
npm test  # Ensure all 235 tests pass before starting
```

### Step 5: Implement WITH Tests

```bash
# Create implementation files
src/embeddings/openai.ts      # New implementation
src/core/types.ts             # Update EmbeddingConfig type
src/factories/index.ts        # Add OpenAI case to factory
config.json                   # Add example OpenAI config

# Create test files
tests/unit/embeddings/openai.test.ts      # Unit tests
tests/integration/openai-embedding.test.ts # Integration tests
```

### Step 6: Test Continuously

```bash
# Run tests after each major change
npm test  # Fix any failures immediately

# Run specific test file during development
npm test -- tests/unit/embeddings/openai.test.ts
```

### Step 7: Final Verification

```bash
# All tests must pass
npm test  # Must show 235+ tests passing (added new tests)

# Manual smoke test
npm run ingest -- --provider openai
```

### Step 8: Commit Only When Tests Pass

```bash
git add .
git commit -m "feat(embeddings): add OpenAI embedding support"
# Only commit if npm test passes 100%
```

---

## Anti-Patterns to Avoid

### ❌ Don't: God Objects

```typescript
// Bad: One class that does everything
class AllInOne {
  ingest() {
    /* ... */
  }
  search() {
    /* ... */
  }
  embed() {
    /* ... */
  }
  export() {
    /* ... */
  }
}
```

### ❌ Don't: Tight Coupling

```typescript
// Bad: Direct instantiation
class MyService {
  private embedder = new GeminiEmbedding(API_KEY);
}

// Good: Dependency injection
class MyService {
  constructor(private embedder: EmbeddingModel) {}
}
```

### ❌ Don't: Hidden State

```typescript
// Bad: Global mutable state
let currentConversation: Conversation | null = null;

// Good: Pass explicitly
function processConversation(conversation: Conversation) {
  // ...
}
```

### ❌ Don't: Stringly-Typed

```typescript
// Bad: Magic strings
if (status === "pending") {
}

// Good: Type-safe enums
type Status = "pending" | "complete";
if (status === "pending") {
} // TypeScript checks this
```

---

## Resources

- **TypeScript Handbook:** https://www.typescriptlang.org/docs/handbook/intro.html
- **better-sqlite3 Docs:** https://github.com/WiseLibs/better-sqlite3/wiki
- **Commander.js Docs:** https://github.com/tj/commander.js
- **Mermaid Diagrams:** https://mermaid.js.org/

---

## Summary Checklist

### Before Starting Implementation

- [ ] Read all files in `docs/`
- [ ] Create new numbered architecture doc
- [ ] Define all interfaces first
- [ ] Plan factory wiring
- [ ] Identify what's reused vs. new
- [ ] Create implementation checklist
- [ ] Get design approved
- [ ] **Run `npm test` to verify baseline passes**

### During Implementation

- [ ] Write tests alongside code (or test-first)
- [ ] Run `npm test` frequently to catch issues early
- [ ] Fix test failures immediately, don't let them accumulate
- [ ] Ensure mock implementations match interface changes

### Before Considering Feature "Done"

- [ ] **ALL tests pass (`npm test` shows 100% pass rate)**
- [ ] New functionality has unit tests
- [ ] Edge cases are tested
- [ ] Integration tests cover end-to-end flows
- [ ] Mock implementations updated for new interfaces
- [ ] No test failures, no skipped tests, no "TODO" test stubs

### Before Committing

- [ ] **Final `npm test` run - MUST be 100% passing**
- [ ] Code follows architecture patterns
- [ ] Documentation updated if needed
- [ ] Commit message follows conventional commits format

**Remember:**

- Good architecture documentation makes implementation faster and more maintainable.
- Passing tests ensure your implementation actually works.
- Time spent writing tests is time NOT spent debugging production issues.
