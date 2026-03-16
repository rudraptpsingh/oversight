import { Command } from "commander"
import fs from "fs"
import path from "path"
import { getOversightDir } from "../../utils/config.js"
import { getDb } from "../../db/schema.js"
import { getAllDecisions } from "../../db/decisions.js"
import { generateOversightMd } from "../../utils/generateMarkdown.js"
import { logger } from "../../utils/logger.js"

export function registerGenerate(program: Command): void {
  program
    .command("generate")
    .description("Generate OVERSIGHT.md — a human and agent-readable summary of all active constraints")
    .option("-o, --output <path>", "Output file path (default: OVERSIGHT.md in repo root)")
    .option("--stdout", "Print to stdout instead of writing a file")
    .action(async (opts: { output?: string; stdout?: boolean }) => {
      const oversightDir = getOversightDir()
      const db = await getDb(oversightDir)
      const decisions = getAllDecisions(db, "active")
      const markdown = generateOversightMd(decisions)

      if (opts.stdout) {
        process.stdout.write(markdown)
        return
      }

      const repoRoot = path.dirname(oversightDir)
      const outputPath = opts.output ?? path.join(repoRoot, "OVERSIGHT.md")

      fs.writeFileSync(outputPath, markdown, "utf-8")
      logger.success(`OVERSIGHT.md written to ${outputPath}`)
      logger.info(`Contains ${decisions.filter((d) => d.status === "active").length} active decision(s).`)
    })
}
