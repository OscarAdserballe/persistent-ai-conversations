#!/usr/bin/env node

import { Command } from 'commander'
import { loadConfig } from '../config'
import { createLearningSearch, createDatabase } from '../factories'
import { getRawDb } from '../db/client'
import { Learning } from '../core/types'

const program = new Command()

program
  .name('search-learnings')
  .description('Search learnings semantically')
  .argument('<query>', 'Search query')
  .option('-c, --config <path>', 'Path to config file', './config.json')
  .option('-l, --limit <number>', 'Maximum number of results', '20')
  .option('--tag <tags...>', 'Filter by tags')
  .option('--type <type>', 'Filter by learning type (principle, method, anti_pattern, exception)')
  .option('--after <date>', 'Filter learnings after this date (YYYY-MM-DD)')
  .option('--before <date>', 'Filter learnings before this date (YYYY-MM-DD)')
  .option('--detailed', 'Show detailed view (default is summary view)')
  .action(async (query: string, options: {
    config: string
    limit: string
    tag?: string[]
    type?: string
    after?: string
    before?: string
    detailed?: boolean
  }) => {
    try {
      // Load configuration
      const config = loadConfig(options.config)

      // Create database connection
      const db = createDatabase(config.db.path)

      // Create learning search
      const learningSearch = createLearningSearch(config, db)

      // Build search options
      const searchOptions: any = {
        limit: parseInt(options.limit, 10)
      }

      if (options.tag) {
        searchOptions.tags = options.tag
      }

      if (options.type) {
        searchOptions.learningType = options.type
      }

      if (options.after || options.before) {
        searchOptions.dateRange = {}
        if (options.after) {
          searchOptions.dateRange.start = new Date(options.after)
        }
        if (options.before) {
          searchOptions.dateRange.end = new Date(options.before)
        }
      }

      console.log(`Searching learnings for: "${query}"\n`)

      // Execute search
      const results = await learningSearch.search(query, searchOptions)

      if (results.length === 0) {
        console.log('No learnings found.')
        getRawDb(db).close()
        process.exit(0)
      }

      console.log(`Found ${results.length} learning(s):\n`)

      // Display results (summary or detailed view)
      for (const result of results) {
        if (options.detailed) {
          displayDetailedLearning(result.learning, result.score, result.sourceConversation)
        } else {
          displaySummaryLearning(result.learning, result.score)
        }
      }

      getRawDb(db).close()
      process.exit(0)

    } catch (error) {
      console.error(`❌ Learning search failed: ${(error as Error).message}`)
      console.error(`\nTroubleshooting:`)
      console.error(`  - Check your API key in config.json`)
      console.error(`  - Ensure database exists`)
      console.error(`  - Verify embeddings are generated for learnings`)
      process.exit(1)
    }
  })

program.parse()

// Display functions

function displaySummaryLearning(learning: Learning, score: number): void {
  const tags = learning.tags.join(', ')
  const principle = learning.abstraction.principle || learning.abstraction.pattern

  console.log(`[${tags}] ${learning.title}`)
  console.log(`  → ${principle}`)

  if (learning.learningType) {
    console.log(`  Type: ${learning.learningType}`)
  }

  console.log(`  Score: ${(score * 100).toFixed(1)}% | Date: ${learning.createdAt.toISOString().split('T')[0]}`)
  console.log()
}

function displayDetailedLearning(
  learning: Learning,
  score: number,
  sourceConv?: { uuid: string; title: string; createdAt: Date }
): void {
  console.log('='.repeat(80))
  console.log(`[${learning.tags.join(', ')}] ${learning.title}`)
  console.log(`Score: ${(score * 100).toFixed(1)}% | Date: ${learning.createdAt.toISOString().split('T')[0]}`)
  console.log('='.repeat(80))
  console.log()

  console.log(`Context: ${learning.context}`)
  console.log()

  console.log(`Insight: ${learning.insight}`)
  console.log()

  console.log(`Why: ${learning.why}`)
  console.log()

  console.log(`Implications: ${learning.implications}`)
  console.log()

  console.log('Abstraction:')
  console.log(`  Concrete: ${learning.abstraction.concrete}`)
  console.log(`  Pattern: ${learning.abstraction.pattern}`)
  if (learning.abstraction.principle) {
    console.log(`  Principle: ${learning.abstraction.principle}`)
  }
  console.log()

  console.log('Understanding:')
  console.log(`  Confidence: ${learning.understanding.confidence}/10`)
  console.log(`  Can teach it: ${learning.understanding.canTeachIt ? 'Yes' : 'No'}`)
  if (learning.understanding.knownGaps && learning.understanding.knownGaps.length > 0) {
    console.log(`  Known gaps: ${learning.understanding.knownGaps.join(', ')}`)
  }
  console.log()

  console.log('Effort:')
  console.log(`  Processing time: ${learning.effort.processingTime}`)
  console.log(`  Cognitive load: ${learning.effort.cognitiveLoad}`)
  console.log()

  console.log('Resonance:')
  console.log(`  Intensity: ${learning.resonance.intensity}/10`)
  console.log(`  Valence: ${learning.resonance.valence}`)
  console.log()

  if (learning.learningType) {
    console.log(`Type: ${learning.learningType}`)
    console.log()
  }

  if (learning.sourceCredit) {
    console.log(`Source credit: ${learning.sourceCredit}`)
    console.log()
  }

  if (sourceConv) {
    console.log('Source:')
    console.log(`  "${sourceConv.title}" (${sourceConv.createdAt.toISOString().split('T')[0]})`)
    console.log()
  }
}
