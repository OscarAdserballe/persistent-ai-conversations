#!/usr/bin/env node

import { Command } from 'commander'
import { loadConfig } from '../config'
import { createDatabase } from '../db/database'
import { createLearningSearch } from '../factories'

const program = new Command()

program
  .name('search-learnings')
  .description('Search learnings semantically')
  .argument('<query>', 'Search query')
  .option('-c, --config <path>', 'Path to config file', './config.json')
  .option('-l, --limit <number>', 'Maximum number of results', '20')
  .option('--category <categories...>', 'Filter by category names')
  .option('--after <date>', 'Filter learnings after this date (YYYY-MM-DD)')
  .option('--before <date>', 'Filter learnings before this date (YYYY-MM-DD)')
  .action(async (query: string, options: {
    config: string
    limit: string
    category?: string[]
    after?: string
    before?: string
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

      if (options.category) {
        searchOptions.categoryNames = options.category
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
        db.close()
        process.exit(0)
      }

      console.log(`Found ${results.length} learning(s):\n`)

      // Display results
      for (const result of results) {
        const categoryNames = result.learning.categories.map(c => c.name).join(', ')

        console.log('='.repeat(80))
        console.log(`[${categoryNames}] ${result.learning.title}`)
        console.log(`Score: ${(result.score * 100).toFixed(1)}% | Date: ${result.learning.createdAt.toISOString().split('T')[0]}`)
        console.log('='.repeat(80))
        console.log()
        console.log(result.learning.content)
        console.log()

        // Show source conversations
        if (result.sourceConversations.length > 0) {
          console.log('Sources:')
          for (const conv of result.sourceConversations) {
            console.log(`  - "${conv.title}" (${conv.createdAt.toISOString().split('T')[0]})`)
          }
          console.log()
        }
      }

      db.close()
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
