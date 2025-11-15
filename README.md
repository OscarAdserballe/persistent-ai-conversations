# LLM Archive

A local conversation archive with semantic search and learning extraction for LLM conversations. Currently supports Claude conversations with plans for OpenAI and other platforms.

## Features

### Core Features

- **Semantic Search** - Find conversations using natural language queries with vector embeddings
- **Learning Extraction** - Automatically identify and extract distilled insights from conversations using LLM analysis
- **Learning Search** - Semantic search over extracted learnings with category filtering
- **Smart Chunking** - Automatically splits large messages (>3000 chars) for better embedding quality
- **Batch Processing** - Efficient embedding generation with rate limiting
- **Context-Aware Results** - Search results include surrounding messages for better understanding

### Technical Features

- **Platform-Agnostic Design** - Clean architecture ready for multiple LLM platforms
- **Local-First** - All data stored locally in SQLite with no external dependencies
- **Dynamic Categories** - User-defined learning categories that evolve with your knowledge
- **Source Linking** - Learnings link back to source conversations for context

## Tech Stack

- **TypeScript** - Type-safe implementation with strict mode
- **SQLite** (better-sqlite3) - Local database with vector embeddings
- **Google Gemini API** - 768-dimension embeddings + text generation (free tier friendly)
  - `text-embedding-004` - Embeddings for search
  - `gemini-2.5-flash-lite` - LLM for learning extraction
- **FTS5** - Full-text search capability (future hybrid search)

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Set up your API key
echo 'GEMINI_API_KEY="your_key_here"' > .env

# 3. Import your conversations
npm run ingest exports/conversations.json

# 4. Search your conversations
npm run search "typescript patterns"

# 5. Extract learnings from conversations
npm run extract-learnings

# 6. Search your learnings
npm run search-learnings "software architecture"
```

## Installation

```bash
# Install dependencies
npm install
```

## Configuration

1. **Create a `.env` file** (use `.env.example` as template):

```bash
GEMINI_API_KEY="your_gemini_api_key_here"
```

2. **Get a Gemini API Key:**

   - Visit [Google AI Studio](https://aistudio.google.com/app/apikey)
   - Create a new API key (free tier available)
   - Copy the key to your `.env` file

3. **Optional: Customize `config.json`:**

The default configuration works well for most use cases. You can customize:

- Batch sizes for ingestion
- Search result limits
- Context window size (messages before/after)
- Database path

## Usage

### Import Conversations

Export your Claude conversations from [claude.ai/account](https://claude.ai/account) and place the `conversations.json` file in the `exports/` directory.

```bash
# Import conversations and generate embeddings
npm run ingest exports/conversations.json
```

This will:

1. Parse the conversation export
2. Flatten complex message structures to searchable text
3. Chunk large messages (>3000 characters)
4. Generate embeddings using Gemini API
5. Store everything in SQLite with vector embeddings

**Progress logging** shows real-time updates as messages are processed.

### Search Conversations

```bash
# Basic search
npm run search "typescript dependency injection patterns"

# Search will return:
# - Most relevant messages with similarity scores
# - Conversation context (2 messages before, 1 after)
# - Conversation metadata (title, date, platform)
```

**Search Options** (future):

- Filter by date range
- Filter by sender (human/assistant)
- Filter by specific conversations
- Adjust result limit

### Extract Learnings

Use LLM analysis to identify and extract distilled insights from conversations:

```bash
# Extract learnings from all conversations
npm run extract-learnings

# This will:
# 1. Analyze each conversation using Gemini Flash LLM
# 2. Identify genuine learnings (technical concepts, personal discoveries, insights)
# 3. Auto-categorize learnings (e.g., "typescript", "architecture", "jazz-fusion")
# 4. Generate embeddings for semantic search
# 5. Link learnings back to source conversations
```

**What counts as a learning?**

- Technical concepts or methodologies genuinely internalized
- Personal discoveries with specific reasoning (books, music, food, design)
- Key insights or realizations showing new understanding
- Patterns or approaches worth remembering

**What doesn't count:**

- Casual mentions without engagement
- Generic information without context
- TODO lists or action items

### Search Learnings

Semantic search over your extracted learnings:

```bash
# Basic learning search
npm run search-learnings "event-driven architecture patterns"

# Search with category filter
npm run search-learnings "functional programming" --category typescript

# Limit results
npm run search-learnings "databases" --limit 5

# Search returns:
# - Relevant learnings with similarity scores
# - Learning categories
# - Source conversation links
# - Creation dates
```

## Architecture

This project uses clean architecture principles:

- **Factory Pattern + Constructor Injection** - Manual dependency injection
- **Interface-Heavy Design** - All providers/importers behind interfaces
- **Embedding Model as Source of Truth** - Dimensions propagate from model
- **Transparent Chunking** - Large messages split automatically, all embeddings at chunk level

For detailed architecture documentation and implementation plan, see [IMPLEMENTATION.md](./IMPLEMENTATION.md).

### Quick Architecture Overview

```
CLI Commands (ingest/search)
    ↓
Factories (dependency injection)
    ↓
Services (importers, embeddings, search)
    ↓
Database Layer (SQLite + vector store)
    ↓
Data (conversations → messages → chunks + embeddings)
```

## Project Structure

```
llm-archive/
├── src/
│   ├── core/types.ts                # All interfaces and data structures
│   ├── embeddings/gemini.ts         # Gemini embedding implementation
│   ├── llm/gemini-flash.ts          # Gemini text generation (for learning extraction)
│   ├── db/                          # Database schema and vector store
│   ├── importers/claude.ts          # Claude conversation importer
│   ├── search/semantic.ts           # Message semantic search engine
│   ├── services/
│   │   ├── learning-extractor.ts    # Extract learnings from conversations
│   │   └── learning-search.ts       # Semantic search over learnings
│   ├── factories/                   # Factory functions for DI
│   └── cli/
│       ├── ingest.ts                # Import conversations
│       ├── search.ts                # Search messages
│       ├── extract-learnings.ts     # Extract learnings
│       └── search-learnings.ts      # Search learnings
├── docs/
│   ├── 0. BASIC IMPLEMENTATION.md   # Core architecture
│   └── 1. LEARNINGS.md              # Learning extraction architecture
├── exports/                         # Place conversation exports here
├── data/                            # SQLite database (auto-created)
├── config.json                      # Configuration
├── Claude.md                        # Development guidelines
└── .env                             # API keys (gitignored)
```

## Testing

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run unit tests only
npm run test:unit

# Run integration tests
npm run test:integration

# Run E2E tests
npm run test:e2e
```

**Test Coverage:** Configured with 80% minimum thresholds for branches, functions, lines, and statements.

## Development

```bash
# Build TypeScript
npm run build

# Type checking
npx tsc --noEmit

# Run tests in watch mode
npm test -- --watch
```

## Database Schema

The database uses the following tables:

### Core Tables

- **conversations** - Metadata for each conversation (title, dates, platform)
- **messages** - Individual messages with full text
- **message_chunks** - Text chunks with embeddings (1+ per message)

### Learning Tables

- **learnings** - Extracted insights with embeddings (title, content, creation date)
- **learning_categories** - Dynamic categories for organizing learnings
- **learning_category_assignments** - Many-to-many link between learnings and categories
- **learning_sources** - Links learnings back to source conversations

Messages over 3000 characters are automatically chunked. All embeddings (both message chunks and learnings) are stored at the row level for optimal search quality.

## Future Enhancements

### Short-term

- OpenAI conversation importer
- Hybrid search (vector + FTS5 keyword search)
- Export search results and learnings
- Resume interrupted ingestion
- Learning diary export (Markdown format)
- Category management CLI (rename, merge categories)

### Long-term

- Topic clustering across conversations
- Temporal analysis (knowledge evolution over time)
- Conversation graph (related discussions)
- Learning relationships (prerequisite knowledge, related concepts)
- Simple localhost API for integration
- Multi-platform learning extraction (OpenAI, Anthropic, etc.)

## Security Notes

- API keys are stored in `.env` and excluded from git
- All database queries use prepared statements (SQL injection protection)
- No external network calls except to Gemini API
- All data stored locally

**Important:** If you accidentally commit your `.env` file or expose your API key, regenerate it immediately at [Google AI Studio](https://aistudio.google.com/app/apikey).

## License

MIT

## Contributing

This is a personal project, but suggestions and bug reports are welcome! Please open an issue to discuss proposed changes.

## Credits

Built with:

- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) - Fast SQLite bindings
- [Google Gemini API](https://ai.google.dev/) - Text embeddings
- [Commander.js](https://github.com/tj/commander.js) - CLI framework
- [Vitest](https://vitest.dev/) - Testing framework
