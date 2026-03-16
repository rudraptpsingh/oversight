import { Command } from "commander"
import fs from "fs"
import path from "path"
import { getDb } from "../../db/schema.js"
import { getOversightDir } from "../../utils/config.js"
import { getAllDecisions } from "../../db/decisions.js"
import { logger } from "../../utils/logger.js"

export function registerExport(program: Command): void {
  program
    .command("export")
    .description("Export decisions to JSON (canonical format for programmatic use)")
    .option("-o, --output <path>", "Output file (default: stdout)")
    .option("--status <status>", "Filter by status (default: active)", "active")
    .action(async (opts: { output?: string; status?: string }) => {
      const oversightDir = getOversightDir()
      const db = await getDb(oversightDir)
      const decisions =
      opts.status === "all" ? getAllDecisions(db) : getAllDecisions(db, opts.status as "active" | "superseded" | "deprecated")

      const json = JSON.stringify(
        { exportedAt: new Date().toISOString(), count: decisions.length, decisions },
        null,
        2
      )

      if (opts.output) {
        const outPath = path.isAbsolute(opts.output) ? opts.output : path.join(process.cwd(), opts.output)
        fs.mkdirSync(path.dirname(outPath), { recursive: true })
        fs.writeFileSync(outPath, json, "utf-8")
        logger.success(`Exported ${decisions.length} decision(s) to ${outPath}`)
      } else {
        process.stdout.write(json)
      }
    })
}
