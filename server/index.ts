import express from "express";
import cors from "cors";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { loadConfig } from "../src/config.js";
import {
  createLearningSearch,
  createLLMModel,
  createDatabase,
} from "../src/factories/index.js";
import { getRawDb } from "../src/db/client.js";
import { IsomorphismEngineImpl } from "./services/isomorphism-engine.js";

const app = express();

// Middleware
app.use(
  cors({
    origin: "http://localhost:5173", // Vite dev server
  })
);
app.use(express.json());

// Initialize services
// Get the project root directory (one level up from server/)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, "..");
const configPath = resolve(projectRoot, "config.json");

const config = loadConfig(configPath);

// Resolve database path relative to project root (not server/ directory)
const dbPath = resolve(projectRoot, config.db.path);
const db = createDatabase(dbPath);

const learningSearch = createLearningSearch(config, db);
const llm = createLLMModel(config);
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

// Get paginated list of learnings (timeline view)
app.get("/api/learnings", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = parseInt(req.query.offset as string) || 0;

    // Query learnings sorted by createdAt DESC
    const rawDb = getRawDb(db);

    const learnings = rawDb
      .prepare(
        `SELECT * FROM learnings
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`
      )
      .all(limit, offset);

    const totalResult = rawDb
      .prepare("SELECT COUNT(*) as count FROM learnings")
      .get() as { count: number };

    const total = totalResult.count;
    const hasMore = offset + limit < total;

    // Parse JSON fields
    const parsedLearnings = learnings.map((l: any) => ({
      ...l,
      tags: JSON.parse(l.tags),
      abstraction: JSON.parse(l.abstraction),
      understanding: JSON.parse(l.understanding),
      effort: JSON.parse(l.effort),
      resonance: JSON.parse(l.resonance),
      createdAt: new Date(l.created_at),
    }));

    res.json({
      learnings: parsedLearnings,
      total,
      hasMore,
    });
  } catch (error) {
    console.error("Error in /api/learnings:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Internal server error",
    });
  }
});

// Get random learning for flashcards
app.get("/api/learnings/random", async (req, res) => {
  try {
    const rawDb = getRawDb(db);

    const learning = rawDb
      .prepare("SELECT * FROM learnings ORDER BY RANDOM() LIMIT 1")
      .get() as any;

    if (!learning) {
      return res.status(404).json({ error: "No learnings found" });
    }

    // Parse JSON fields
    const parsedLearning = {
      ...learning,
      tags: JSON.parse(learning.tags),
      abstraction: JSON.parse(learning.abstraction),
      understanding: JSON.parse(learning.understanding),
      effort: JSON.parse(learning.effort),
      resonance: JSON.parse(learning.resonance),
      createdAt: new Date(learning.created_at),
    };

    res.json({ learning: parsedLearning });
  } catch (error) {
    console.error("Error in /api/learnings/random:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Internal server error",
    });
  }
});

const PORT = config.server?.port || 3001;
app.listen(PORT, () => {
  console.log(
    `🔮 Isomorphism Engine API running on http://localhost:${PORT}`
  );
  console.log(`📊 Database: ${config.db.path}`);
  console.log(`🤖 LLM: ${config.llm.model}`);
});
