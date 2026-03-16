import { Command } from "commander"
import chalk from "chalk"
import { getOversightDir } from "../../utils/config.js"
import { getDb } from "../../db/schema.js"
import { getAllDecisions } from "../../db/decisions.js"
import { getFilesAboveChurnThreshold } from "../../git/diff.js"
import { logger } from "../../utils/logger.js"

const CHURN_THRESHOLD = 3
const CHURN_DAYS = 90
const STALE_DAYS = 180

export function registerHeatmap(program: Command): void {
  program
    .command("heatmap")
    .description("Show files that need decisions based on git churn")
    .option("--json", "Output raw JSON")
    .action(async (opts: { json?: boolean }) => {
      const oversightDir = getOversightDir()
      const db = await getDb(oversightDir)

      let churnFiles: string[]
      try {
        churnFiles = getFilesAboveChurnThreshold(CHURN_DAYS, CHURN_THRESHOLD)
      } catch {
        logger.error("Could not read git log. Are you in a git repository?")
        return
      }

      const decisions = getAllDecisions(db)
      const staleThreshold = Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000

      const highRisk: string[] = []
      const mediumRisk: string[] = []
      const covered: string[] = []

      for (const file of churnFiles) {
        const fileDecisions = decisions.filter((d) =>
          d.anchors.some((a) => {
            const ap = a.path.replace(/^\.\//, "")
            const fp = file.replace(/^\.\//, "")
            return ap === fp || fp.startsWith(ap + "/")
          })
        )

        if (fileDecisions.length === 0) {
          highRisk.push(file)
        } else {
          const hasStale = fileDecisions.some(
            (d) =>
              new Date(d.timestamp).getTime() < staleThreshold ||
              d.confidence === "exploratory" ||
              d.status === "needs-review"
          )
          if (hasStale) mediumRisk.push(file)
          else covered.push(file)
        }
      }

      if (opts.json) {
        console.log(JSON.stringify({ highRisk, mediumRisk, covered }, null, 2))
        return
      }

      console.log("")
      if (highRisk.length > 0) {
        console.log(chalk.bold.red("HIGH RISK — high churn, no decisions:"))
        for (const f of highRisk) console.log(chalk.red(`  • ${f}`))
        console.log("")
      }
      if (mediumRisk.length > 0) {
        console.log(chalk.bold.yellow("MEDIUM RISK — decisions exist but may be outdated:"))
        for (const f of mediumRisk) console.log(chalk.yellow(`  • ${f}`))
        console.log("")
      }
      if (covered.length > 0) {
        console.log(chalk.bold.green("COVERED — decisions present and current:"))
        for (const f of covered) console.log(chalk.green(`  • ${f}`))
        console.log("")
      }
      if (highRisk.length === 0 && mediumRisk.length === 0 && covered.length === 0) {
        logger.info("No high-churn files found in the last 90 days.")
      }

      logger.info(`${highRisk.length} high risk, ${mediumRisk.length} medium risk, ${covered.length} covered`)
    })
}
