import express from "express";
import cors from "cors";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { loadConfig } from "../src/config.js";
import {
  createLearningSearch,
  createDatabase,
} from "../src/factories/index.js";
import { IsomorphismEngineImpl } from "./services/isomorphism-engine.js";
import { getModel } from "../src/llm/client.js";
import { getLearnings, getRandomLearning } from "../src/api/learnings.js";

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
app.get("/api/learnings/random", async (req, res) => {
  try {
    const learning = getRandomLearning(db);

    if (!learning) {
      return res.status(404).json({ error: "No learnings found" });
    }

    res.json({ learning });
  } catch (error) {
    console.error("Error in /api/learnings/random:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Internal server error",
    });
  }
});

const PORT = config.server?.port || 3001;
app.listen(PORT, () => {
  console.log(`🔮 Isomorphism Engine API running on http://localhost:${PORT}`);
  console.log(`📊 Database: ${config.db.path}`);
  console.log(`🤖 LLM: ${config.llm.model}`);
});
