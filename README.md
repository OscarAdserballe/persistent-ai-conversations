# LLM Archive

A local conversation archive with semantic search for LLM conversations. Currently supports Claude conversations with plans for OpenAI and other platforms.

## Features

- **Semantic Search** - Find conversations using natural language queries with vector embeddings
- **Smart Chunking** - Automatically splits large messages (>3000 chars) for better embedding quality
- **Batch Processing** - Efficient embedding generation with rate limiting
- **Context-Aware Results** - Search results include surrounding messages for better understanding
- **Platform-Agnostic Design** - Clean architecture ready for multiple LLM platforms
- **Local-First** - All data stored locally in SQLite with no external dependencies

## Tech Stack

- **TypeScript** - Type-safe implementation with strict mode
- **SQLite** (better-sqlite3) - Local database with vector embeddings
- **Google Gemini API** - 768-dimension embeddings (free tier friendly)
- **FTS5** - Full-text search capability (future hybrid search)

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
│   ├── core/types.ts          # All interfaces and data structures
│   ├── embeddings/gemini.ts   # Gemini embedding implementation
│   ├── db/                    # Database schema and vector store
│   ├── importers/claude.ts    # Claude conversation importer
│   ├── search/semantic.ts     # Semantic search engine
│   ├── factories/             # Factory functions for DI
│   └── cli/                   # CLI commands (ingest, search)
├── exports/                   # Place conversation exports here
├── data/                      # SQLite database (auto-created)
├── config.json                # Configuration
└── .env                       # API keys (gitignored)
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

The database uses three main tables:

- **conversations** - Metadata for each conversation (title, dates, platform)
- **messages** - Individual messages with full text
- **message_chunks** - Text chunks with embeddings (1+ per message)

Messages over 3000 characters are automatically chunked. All embeddings are stored at the chunk level for optimal search quality.

## Future Enhancements

### Short-term
- OpenAI conversation importer
- Hybrid search (vector + FTS5 keyword search)
- Export search results
- Resume interrupted ingestion

### Long-term
- Learnings extraction using LLM
- Topic clustering
- Temporal analysis
- Conversation graph (related discussions)
- Simple localhost API for integration

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
