import { readFileSync } from 'fs'
import { resolve } from 'path'
import { config as dotenvConfig } from 'dotenv'
import { Config } from './core/types'

// Load environment variables from .env file
dotenvConfig()

/**
 * Load and validate configuration from config.json
 * API keys can be overridden with environment variables
 */
export function loadConfig(configPath?: string): Config {
  const path = configPath || resolve(process.cwd(), 'config.json')

  try {
    const content = readFileSync(path, 'utf-8')
    const config = JSON.parse(content) as Config

    // Override API key with environment variable if present
    if (process.env.GEMINI_API_KEY) {
      config.embedding.apiKey = process.env.GEMINI_API_KEY
    }

    validateConfig(config)

    return config
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Config file not found at: ${path}`)
    }
    throw error
  }
}

/**
 * Validate configuration object
 */
function validateConfig(config: Config): void {
  if (!config.embedding) {
    throw new Error('Missing embedding configuration')
  }

  if (!config.embedding.provider) {
    throw new Error('Missing embedding.provider')
  }

  if (!config.embedding.apiKey || config.embedding.apiKey === 'YOUR_GEMINI_API_KEY_HERE') {
    throw new Error('Missing embedding.apiKey - please set GEMINI_API_KEY in .env file or update config.json')
  }

  if (!config.embedding.model) {
    throw new Error('Missing embedding.model')
  }

  if (!config.embedding.dimensions || config.embedding.dimensions <= 0) {
    throw new Error('Invalid embedding.dimensions')
  }

  if (!config.db) {
    throw new Error('Missing db configuration')
  }

  if (!config.db.path) {
    throw new Error('Missing db.path')
  }

  if (!config.search) {
    throw new Error('Missing search configuration')
  }

  if (!config.ingestion) {
    throw new Error('Missing ingestion configuration')
  }
}

/**
 * Create a default config object (useful for testing)
 */
export function createDefaultConfig(overrides?: Partial<Config>): Config {
  const defaults: Config = {
    embedding: {
      provider: 'gemini',
      apiKey: 'test-key',
      model: 'text-embedding-004',
      dimensions: 768,
      batchSize: 100,
      rateLimitDelayMs: 100
    },
    db: {
      path: './data/conversations.db'
    },
    search: {
      defaultLimit: 20,
      contextWindow: {
        before: 2,
        after: 1
      }
    },
    ingestion: {
      batchSize: 50,
      progressLogging: true
    }
  }

  if (!overrides) return defaults

  return {
    ...defaults,
    ...overrides,
    embedding: { ...defaults.embedding, ...overrides.embedding },
    db: { ...defaults.db, ...overrides.db },
    search: { ...defaults.search, ...overrides.search },
    ingestion: { ...defaults.ingestion, ...overrides.ingestion }
  }
}
