import { Command } from "commander"
import { execSync } from "child_process"
import fs from "fs"
import path from "path"
import { getDb } from "../../db/schema.js"
import { getOversightDir } from "../../utils/config.js"
import { readEnforcement, writeEnforcement } from "../../utils/config.js"
import { handleCheckChange } from "../../mcp/tools/checkChange.js"
import { logger } from "../../utils/logger.js"

function getStagedFiles(cwd: string): string[] {
  try {
    const out = execSync("git diff --cached --name-only", {
      encoding: "utf-8",
      cwd,
    })
    return out
      .split("\n")
      .map((f) => f.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

export function registerEnforce(program: Command): void {
  const enforce = program
    .command("enforce")
    .description("Enforcement: check staged changes against decision constraints")

  enforce
    .command("staged")
    .description("Check staged files against constraints. Exits 1 if blocked (use in pre-commit).")
    .option("--dry-run", "Print warnings but exit 0 even when blocked (for CI preview)")
    .action(async (opts: { dryRun?: boolean }) => {
      const cwd = process.cwd()
      const oversightDir = getOversightDir(cwd)
      const db = await getDb(oversightDir)

      const staged = getStagedFiles(cwd)
      if (staged.length === 0) {
        process.exit(0)
      }

      const result = handleCheckChange(db, {
        changeDescription: `Staged commit: ${staged.join(", ")}`,
        affectedPaths: staged,
      })

      for (const w of result.warnings) {
        console.log(`  ⚠ ${w}`)
      }

      if (result.blocked && !opts.dryRun) {
        console.error("")
        console.error(result.blockReason ?? "Blocked by Oversight enforcement.")
        console.error("")
        console.error("To bypass: git commit --no-verify")
        console.error("To turn off: oversight enforce off")
        process.exit(1)
      }

      if (result.blocked && opts.dryRun) {
        console.log("")
        console.log("(Dry-run: would block but exiting 0)")
      }

      if (result.warnings.length > 0) {
        console.log("")
      }
      process.exit(0)
    })

  enforce
    .command("on")
    .description("Enable blocking enforcement (pre-commit will block on violations)")
    .option("--strict", "Block on any high-risk change (default: block only must-violations)")
    .action((opts: { strict?: boolean }) => {
      const cwd = process.cwd()
      writeEnforcement(
        {
          mode: "blocking",
          blockOnMustViolation: true,
          blockOnHighRisk: opts.strict ?? false,
        },
        cwd
      )
      logger.success("Enforcement enabled (blocking mode).")
      logger.info("Pre-commit will block commits that violate MUST constraints.")
    })

  enforce
    .command("off")
    .description("Disable blocking (advisory mode: warn only)")
    .action(() => {
      const cwd = process.cwd()
      writeEnforcement(
        {
          mode: "advisory",
          blockOnMustViolation: false,
          blockOnHighRisk: false,
        },
        cwd
      )
      logger.success("Enforcement disabled (advisory mode).")
    })

  enforce
    .command("status")
    .description("Show current enforcement settings")
    .action(() => {
      const cwd = process.cwd()
      const cfg = readEnforcement(cwd)
      console.log("")
      console.log("  Mode:              " + cfg.mode)
      console.log("  Block on MUST:     " + cfg.blockOnMustViolation)
      console.log("  Block on high:     " + cfg.blockOnHighRisk)
      console.log("")
    })
}
