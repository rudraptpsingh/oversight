import { Command } from "commander"
import { getOversightDir } from "../../utils/config.js"
import { getDb } from "../../db/schema.js"
import { getDecisionsByPath } from "../../db/decisions.js"
import { logger } from "../../utils/logger.js"

export function registerCheck(program: Command): void {
  program
    .command("check <filepath>")
    .description("Show decisions anchored to a file path")
    .option("--json", "Output raw JSON")
    .action(async (filepath: string, opts: { json?: boolean }) => {
      const oversightDir = getOversightDir()
      const db = await getDb(oversightDir)
      const records = getDecisionsByPath(db, filepath)

      if (opts.json) {
        console.log(JSON.stringify(records, null, 2))
        return
      }

      if (records.length === 0) {
        logger.info(`No Oversight decisions for this path: ${filepath}`)
        return
      }

      logger.info(`Found ${records.length} decision(s) for ${filepath}:`)
      for (const record of records) {
        logger.decision(record)
      }
    })
}
