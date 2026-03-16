import { Command } from "commander"
import { getOversightDir } from "../../utils/config.js"
import { getDb } from "../../db/schema.js"
import { getAllDecisions } from "../../db/decisions.js"
import { logger } from "../../utils/logger.js"
import type { DecisionStatus } from "../../types/index.js"

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

export function registerList(program: Command): void {
  program
    .command("list")
    .description("List recorded decisions")
    .option("--status <status>", "Filter by status")
    .option("--tag <tag>", "Filter by tag")
    .option("--type <type>", "Filter by decision type")
    .option("--json", "Output raw JSON")
    .action(async (opts: { status?: string; tag?: string; type?: string; json?: boolean }) => {
      const oversightDir = getOversightDir()
      const db = await getDb(oversightDir)

      let records = opts.status
        ? getAllDecisions(db, opts.status as DecisionStatus)
        : getAllDecisions(db, "active")

      if (opts.tag) records = records.filter((r) => r.tags.includes(opts.tag!))
      if (opts.type) records = records.filter((r) => r.decisionType === opts.type)

      if (opts.json) {
        console.log(JSON.stringify(records, null, 2))
        return
      }

      if (records.length === 0) {
        logger.info("No decisions found.")
        return
      }

      const rows = records.map((r) => ({
        ID: r.id.slice(0, 8),
        TITLE: r.title.slice(0, 40),
        TYPE: r.decisionType,
        CONFIDENCE: r.confidence,
        ANCHORS: String(r.anchors.length),
        AGE: ageString(r.timestamp),
      }))

      logger.table(rows, ["ID", "TITLE", "TYPE", "CONFIDENCE", "ANCHORS", "AGE"])
      console.log("")
      logger.info(`${records.length} decision(s) found`)
      logger.info("Dashboard: http://localhost:7654 — run `oversight dashboard` to start")
    })
}
