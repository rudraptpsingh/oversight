import { Command } from "commander"
import { getOversightDir } from "../../utils/config.js"
import { getDb } from "../../db/schema.js"
import { searchDecisions } from "../../db/search.js"
import { logger } from "../../utils/logger.js"
import type { DecisionType } from "../../types/index.js"

function ageString(timestamp: string): string {
  const ms = Date.now() - new Date(timestamp).getTime()
  const days = Math.floor(ms / (1000 * 60 * 60 * 24))
  if (days === 0) return "today"
  if (days === 1) return "1 day"
  if (days < 30) return `${days} days`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo`
  return `${Math.floor(months / 12)}yr`
}

export function registerSearch(program: Command): void {
  program
    .command("search <query>")
    .description("Full-text search across all decisions")
    .option("--tag <tag>", "Filter results by tag (comma-separated for multiple)")
    .option("--type <type>", "Filter results by decision type")
    .option("--limit <n>", "Max results to return", "10")
    .option("--json", "Output raw JSON")
    .action(async (query: string, opts: { tag?: string; type?: string; limit?: string; json?: boolean }) => {
      const oversightDir = getOversightDir()
      const db = await getDb(oversightDir)

      const tags = opts.tag ? opts.tag.split(",").map((t) => t.trim()) : undefined
      const decisionTypes = opts.type ? [opts.type as DecisionType] : undefined
      const limit = parseInt(opts.limit ?? "10", 10)

      const results = searchDecisions(db, {
        query,
        tags,
        decisionTypes,
        limit,
      })

      if (opts.json) {
        console.log(JSON.stringify(results, null, 2))
        return
      }

      if (results.length === 0) {
        logger.info(`No decisions found matching "${query}"`)
        return
      }

      const rows = results.map((r) => ({
        ID: r.id.slice(0, 8),
        TITLE: r.title.slice(0, 45),
        TYPE: r.decisionType,
        CONFIDENCE: r.confidence,
        AGE: ageString(r.timestamp),
      }))

      logger.table(rows, ["ID", "TITLE", "TYPE", "CONFIDENCE", "AGE"])
      console.log("")
      logger.info(`${results.length} result(s) for "${query}"`)
    })
}
