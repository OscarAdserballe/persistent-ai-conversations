#!/usr/bin/env node

import { Command } from 'commander'
import { loadConfig } from '../config'
import { createDatabase } from '../db/database'
import { createSearchEngine } from '../factories'

const program = new Command()

program
  .name('search')
  .description('Search conversations semantically')
  .argument('<query>', 'Search query')
  .option('-c, --config <path>', 'Path to config file', './config.json')
  .option('-l, --limit <number>', 'Maximum number of results', '10')
  .option('-s, --sender <sender>', 'Filter by sender (human or assistant)')
  .option('--after <date>', 'Filter messages after this date (YYYY-MM-DD)')
  .option('--before <date>', 'Filter messages before this date (YYYY-MM-DD)')
  .action(async (query: string, options: {
    config: string
    limit: string
    sender?: 'human' | 'assistant'
    after?: string
    before?: string
  }) => {
    try {
      // Load configuration
      const config = loadConfig(options.config)

      // Create database connection
      const db = createDatabase(config.db.path)

      // Create search engine
      const searchEngine = createSearchEngine(config, db)

      // Build search options
      const searchOptions: any = {
        limit: parseInt(options.limit, 10)
      }

      if (options.sender) {
        searchOptions.sender = options.sender
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

      console.log(`Searching for: "${query}"\n`)

      // Execute search
      const results = await searchEngine.search(query, searchOptions)

      if (results.length === 0) {
        console.log('No results found.')
        db.close()
        process.exit(0)
      }

      console.log(`Found ${results.length} result(s):\n`)

      // Display results
      for (const result of results) {
        console.log('='.repeat(80))
        console.log(`Conversation: "${result.conversation.title}"`)
        console.log(`Date: ${result.conversation.createdAt.toISOString().split('T')[0]}`)
        console.log(`Score: ${(result.score * 100).toFixed(1)}%`)
        console.log('='.repeat(80))
        console.log()

        // Show previous messages (context)
        if (result.previousMessages.length > 0) {
          for (const msg of result.previousMessages) {
            console.log(`[${msg.sender.toUpperCase()}]: ${truncate(msg.text, 200)}`)
            console.log()
          }
        }

        // Highlight matched message
        console.log(`>>> [${result.message.sender.toUpperCase()}]: ${result.message.text}`)
        console.log()

        // Show next messages (context)
        if (result.nextMessages.length > 0) {
          for (const msg of result.nextMessages) {
            console.log(`[${msg.sender.toUpperCase()}]: ${truncate(msg.text, 200)}`)
            console.log()
          }
        }

        console.log()
      }

      db.close()
      process.exit(0)
    } catch (error) {
      console.error('\n❌ Error during search:')
      console.error((error as Error).message)
      process.exit(1)
    }
  })

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.substring(0, maxLength) + '...'
}

program.parse()
