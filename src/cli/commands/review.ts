import { Command } from "commander"
import inquirer from "inquirer"
import { getOversightDir } from "../../utils/config.js"
import { getDb } from "../../db/schema.js"
import { getAllDecisions, updateDecision } from "../../db/decisions.js"
import { logger } from "../../utils/logger.js"

const STALE_DAYS = 180

export function registerReview(program: Command): void {
  program
    .command("review")
    .description("Review decisions that need attention")
    .action(async () => {
      const oversightDir = getOversightDir()
      const db = await getDb(oversightDir)
      const all = getAllDecisions(db)
      const staleThreshold = Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000

      const toReview = all.filter((r) => {
        if (r.status === "needs-review") return true
        if (new Date(r.timestamp).getTime() < staleThreshold) return true
        return false
      })

      if (toReview.length === 0) {
        logger.success("No decisions need review right now.")
        return
      }

      logger.info(`${toReview.length} decision(s) need review:`)

      for (const record of toReview) {
        const reason = record.status === "needs-review"
          ? "Status: needs-review"
          : `Last updated over ${STALE_DAYS} days ago`

        console.log(`\n  Reason for review: ${reason}`)
        logger.decision(record)

        const { action } = await inquirer.prompt([
          {
            type: "list",
            name: "action",
            message: "What would you like to do?",
            choices: [
              { name: "Mark as reviewed (set active)", value: "active" },
              { name: "Mark as deprecated", value: "deprecated" },
              { name: "Mark as superseded", value: "superseded" },
              { name: "Skip", value: "skip" },
            ],
          },
        ])

        if (action !== "skip") {
          updateDecision(db, record.id, { status: action })
          logger.success(`Updated decision ${record.id.slice(0, 8)} → ${action}`)
        }
      }
    })
}
