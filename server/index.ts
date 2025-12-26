import { config as dotenvConfig } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// Load .env from project root (parent of server/)
const __filename_env = fileURLToPath(import.meta.url);
const __dirname_env = dirname(__filename_env);
dotenvConfig({ path: resolve(__dirname_env, "..", ".env") });

import express from "express";
import cors from "cors";
import { loadConfig } from "../src/config.js";
import {
  createLearningSearch,
  createDatabase,
  createTopicExtractor,
  createTopicLearningExtractor,
} from "../src/factories/index.js";
import { IsomorphismEngineImpl } from "./services/isomorphism-engine.js";
import { getModel } from "../src/llm/client.js";
import { getLearnings, getRandomLearning } from "../src/api/learnings.js";
import { getTopicById, getLearningsByTopicId, getTopicsByPdfId } from "../src/api/topics.js";
import { getAllPdfsWithTopics, getPdfById } from "../src/api/pdfs.js";

// Default prompts (same as CLI commands)
const TOPIC_EXTRACTION_PROMPT = `Extract the main topics from this document. For each topic:
- Title: Concise, descriptive name (max 100 chars)
- Summary: 1-2 sentences explaining what this topic covers
- Key Points: 3-5 bullet points of important information
- Source Text: The actual relevant content from the document that covers this topic.
  Include formulas, definitions, theorems, proofs, and explanations.
  This should be verbatim or near-verbatim text that a student would read to understand the topic.
  NOT just headings or outlines - include the actual educational content.

Guidelines by document type:
- For lecture slides: Focus on concepts taught, not administrative content. Include formulas and definitions.
- For papers: Focus on methodology, findings, contributions. Include key equations and results.
- For exercises: Focus on problem statements and solution approaches.

Return 3-8 topics depending on document length. Include subtopics if there are naturally nested concepts.

If the document has no substantial topics (e.g., table of contents only), return an empty array.`;

const LEARNING_EXTRACTION_PROMPT = `You are extracting exam-prep flashcards from academic content.

Given a TOPIC with its summary and key points, create learnings with:

1. **title**: Specific, memorable - something you'd recognize in a flashcard deck
2. **problemSpace**: "When/why would you need this?" - the situation that makes this relevant
3. **insight**: Core realization (1-2 sentences) - the "aha!" moment
4. **blocks**: Array of Q&A pairs (aim for 8-15), each with:
   - blockType: 'qa' | 'why' | 'contrast'
   - question: Front of flashcard
   - answer: Back of flashcard

Block type guidelines:
- 'qa': Definitions, procedures, proof outlines, formulas
- 'why': "Why is X true?" - forces deeper understanding
- 'contrast': "How does X differ from Y?" - highlights distinctions

Example proof outline block:
{
  "blockType": "qa",
  "question": "What's the proof outline for [theorem]?",
  "answer": "1. [Step 1]\\n2. [Step 2]\\n3. [Step 3]\\n4. [Conclusion]"
}

Return a JSON array of learnings. Be thorough - more blocks means better flashcard coverage.
If the topic has no substantial learning content, return an empty array.`;

const app = express();

// Middleware
app.use(
  cors({
    origin: "http://localhost:5173", // Vite dev server
  })
);
app.use(express.json());

// Initialize services
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, "..");
const configPath = resolve(projectRoot, "config.json");

const config = loadConfig(configPath);

// Resolve database path relative to project root
const dbPath = resolve(projectRoot, config.db.path);
const db = createDatabase(dbPath);

const learningSearch = createLearningSearch(config, db);
const llm = getModel(config.llm.model);
const engine = new IsomorphismEngineImpl(learningSearch, llm);

// Routes

app.post("/api/explain", async (req, res) => {
  try {
    const { concept, limit, customPrompt } = req.body;

    if (!concept || typeof concept !== "string") {
      return res.status(400).json({
        error: 'Missing or invalid "concept" field',
      });
    }

    const result = await engine.explain(concept, {
      learningLimit: limit,
      customPrompt,
    });

    res.json(result);
  } catch (error) {
    console.error("Error in /api/explain:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Internal server error",
    });
  }
});

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

// Get paginated list of learnings (using API layer)
app.get("/api/learnings", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = parseInt(req.query.offset as string) || 0;

    const result = getLearnings(db, { limit, offset });

    res.json(result);
  } catch (error) {
    console.error("Error in /api/learnings:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Internal server error",
    });
  }
});

// Get random learning for flashcards (using API layer)
// Includes the source topic if learning is from a topic
app.get("/api/learnings/random", async (req, res) => {
  try {
    const learning = getRandomLearning(db);

    if (!learning) {
      return res.status(404).json({ error: "No learnings found" });
    }

    // If the learning is from a topic, include the topic data (now with sourceText field)
    let topic = null;
    if (learning.sourceType === "topic") {
      topic = getTopicById(db, learning.sourceId);
    }

    res.json({ learning, topic });
  } catch (error) {
    console.error("Error in /api/learnings/random:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Internal server error",
    });
  }
});

// Get all PDFs with their nested topics (for sidebar)
app.get("/api/pdfs", (req, res) => {
  try {
    const pdfs = getAllPdfsWithTopics(db);
    res.json({ pdfs });
  } catch (error) {
    console.error("Error in /api/pdfs:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Internal server error",
    });
  }
});

// Get learnings for a specific topic
app.get("/api/topics/:topicId/learnings", (req, res) => {
  try {
    const { topicId } = req.params;
    const learnings = getLearningsByTopicId(db, topicId);
    const topic = getTopicById(db, topicId);

    if (!topic) {
      return res.status(404).json({ error: "Topic not found" });
    }

    res.json({ topic, learnings });
  } catch (error) {
    console.error("Error in /api/topics/:topicId/learnings:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Internal server error",
    });
  }
});

// ============================================================================
// EXTRACTION ENDPOINTS
// ============================================================================

// Extract topics from a PDF
app.post("/api/pdfs/:pdfId/extract-topics", async (req, res) => {
  const { pdfId } = req.params;
  const { overwrite } = req.body;

  try {
    // Verify PDF exists
    const pdf = getPdfById(db, pdfId);
    if (!pdf) {
      return res.status(404).json({ error: "PDF not found" });
    }

    console.log(`[API] Extracting topics from PDF: ${pdf.title || pdf.filename}`);

    const extractor = createTopicExtractor(config, db, TOPIC_EXTRACTION_PROMPT);
    const topics = await extractor.extractFromPDF(pdfId, { overwrite });

    console.log(`[API] Extracted ${topics.length} topics`);

    res.json({
      success: true,
      pdfId,
      topicsExtracted: topics.length,
      topics: topics.map((t) => ({
        topicId: t.topicId,
        title: t.title,
        depth: t.depth,
      })),
    });
  } catch (error) {
    console.error("Error in /api/pdfs/:pdfId/extract-topics:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Topic extraction failed",
    });
  }
});

// Extract learnings from all topics of a PDF
app.post("/api/pdfs/:pdfId/extract-learnings", async (req, res) => {
  const { pdfId } = req.params;

  try {
    // Verify PDF exists
    const pdf = getPdfById(db, pdfId);
    if (!pdf) {
      return res.status(404).json({ error: "PDF not found" });
    }

    // Get topics for this PDF
    const topics = getTopicsByPdfId(db, pdfId);
    if (topics.length === 0) {
      return res.status(400).json({
        error: "No topics found for this PDF. Extract topics first.",
      });
    }

    console.log(`[API] Extracting learnings from ${topics.length} topics for PDF: ${pdf.title || pdf.filename}`);

    const extractor = createTopicLearningExtractor(
      config,
      db,
      LEARNING_EXTRACTION_PROMPT
    );

    let totalLearnings = 0;
    const results: Array<{
      topicId: string;
      title: string;
      learningsExtracted: number;
    }> = [];

    for (const topic of topics) {
      try {
        const learnings = await extractor.extractFromTopic(topic);
        totalLearnings += learnings.length;
        results.push({
          topicId: topic.topicId,
          title: topic.title,
          learningsExtracted: learnings.length,
        });
        console.log(`  ✓ ${topic.title}: ${learnings.length} learnings`);
      } catch (err) {
        console.error(`  ✗ ${topic.title}: ${(err as Error).message}`);
        results.push({
          topicId: topic.topicId,
          title: topic.title,
          learningsExtracted: 0,
        });
      }

      // Small delay between topics to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    console.log(`[API] Total: ${totalLearnings} learnings from ${topics.length} topics`);

    res.json({
      success: true,
      pdfId,
      topicsProcessed: topics.length,
      totalLearnings,
      results,
    });
  } catch (error) {
    console.error("Error in /api/pdfs/:pdfId/extract-learnings:", error);
    res.status(500).json({
      error:
        error instanceof Error ? error.message : "Learning extraction failed",
    });
  }
});

const PORT = config.server?.port || 3001;
app.listen(PORT, () => {
  console.log(`🔮 Isomorphism Engine API running on http://localhost:${PORT}`);
  console.log(`📊 Database: ${config.db.path}`);
  console.log(`🤖 LLM: ${config.llm.model}`);
});
