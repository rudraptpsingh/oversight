import { Command } from "commander"
import chalk from "chalk"
import { getOversightDir } from "../../utils/config.js"
import { getDb } from "../../db/schema.js"
import { computeMetrics } from "../../db/metrics.js"

function bar(value: number, max: number, width = 20): string {
  const filled = max > 0 ? Math.round((value / max) * width) : 0
  return chalk.cyan("█".repeat(filled)) + chalk.gray("░".repeat(width - filled))
}

function pct(value: number, total: number): string {
  if (total === 0) return "0%"
  return `${Math.round((value / total) * 100)}%`
}

export function registerMetrics(program: Command): void {
  program
    .command("metrics")
    .description("Show impact metrics for your decision knowledge base")
    .option("--json", "Output raw JSON")
    .action(async (opts: { json?: boolean }) => {
      const oversightDir = getOversightDir()
      const db = await getDb(oversightDir)
      const m = computeMetrics(db)

      if (opts.json) {
        console.log(JSON.stringify(m, null, 2))
        return
      }

      const w = 56
      const divider = chalk.gray("─".repeat(w))

      console.log("")
      console.log(chalk.bold.white("  Oversight — Decision Memory Metrics"))
      console.log(divider)

      console.log("")
      console.log(chalk.bold("  KNOWLEDGE BASE"))
      console.log("")

      const total = m.decisions.total
      console.log(`  Total decisions        ${chalk.bold.white(String(total))}`)
      console.log(`    Active               ${chalk.green(String(m.decisions.active))}  ${bar(m.decisions.active, total)}  ${pct(m.decisions.active, total)}`)
      console.log(`    Superseded           ${chalk.yellow(String(m.decisions.superseded))}  ${bar(m.decisions.superseded, total)}  ${pct(m.decisions.superseded, total)}`)
      console.log(`    Deprecated           ${chalk.gray(String(m.decisions.deprecated))}  ${bar(m.decisions.deprecated, total)}  ${pct(m.decisions.deprecated, total)}`)
      console.log(`    Needs review         ${chalk.red(String(m.decisions.needsReview))}  ${bar(m.decisions.needsReview, total)}  ${pct(m.decisions.needsReview, total)}`)
      console.log("")
      console.log(`  Unique files protected ${chalk.bold.white(String(m.decisions.uniqueFilesProtected))}`)
      console.log(`  Total anchors          ${chalk.white(String(m.decisions.anchorsTotal))}`)
      console.log(`  Alternatives documented${chalk.white(String(m.decisions.alternativesDocumented).padStart(3))}  ${chalk.gray("(rejected paths on record)")}`)
      console.log("")

      console.log(divider)
      console.log("")
      console.log(chalk.bold("  CONSTRAINTS"))
      console.log("")
      console.log(`  Decisions with constraints  ${chalk.bold.white(String(m.decisions.withConstraints))}  ${chalk.gray(`/ ${total}`)}`)
      console.log(`    MUST constraints total    ${chalk.red.bold(String(m.decisions.mustConstraintTotal))}`)
      console.log(`    SHOULD constraints total  ${chalk.yellow(String(m.decisions.shouldConstraintTotal))}`)
      console.log(`  Constraint density          ${chalk.white(String(m.coverage.constraintDensity))}  ${chalk.gray("constraints per decision")}`)
      console.log(`  With do-not-change patterns ${chalk.white(String(m.decisions.withDoNotChange))}`)
      console.log(`  With agent hints            ${chalk.white(String(m.decisions.withAgentHints))}  ${chalk.gray(`(${pct(m.decisions.withAgentHints, total)} of decisions)`)}`)
      console.log("")

      console.log(divider)
      console.log("")
      console.log(chalk.bold("  CHANGE RISK ASSESSMENTS  ") + chalk.gray("(oversight_check_change calls)"))
      console.log("")

      const checks = m.checkChange.totalChecks
      if (checks === 0) {
        console.log(chalk.gray("  No change checks recorded yet."))
        console.log(chalk.gray("  Run oversight_check_change before making significant code changes."))
      } else {
        console.log(`  Total checks run       ${chalk.bold.white(String(checks))}`)
        console.log(`    High risk flagged    ${chalk.red.bold(String(m.checkChange.highRiskBlocked))}  ${bar(m.checkChange.highRiskBlocked, checks)}  ${pct(m.checkChange.highRiskBlocked, checks)}`)
        console.log(`    Medium risk flagged  ${chalk.yellow(String(m.checkChange.mediumRiskFlagged))}  ${bar(m.checkChange.mediumRiskFlagged, checks)}  ${pct(m.checkChange.mediumRiskFlagged, checks)}`)
        console.log(`    Low risk cleared     ${chalk.green(String(m.checkChange.lowRiskCleared))}  ${bar(m.checkChange.lowRiskCleared, checks)}  ${pct(m.checkChange.lowRiskCleared, checks)}`)
        console.log("")
        console.log(`  Total warnings issued      ${chalk.bold.white(String(m.checkChange.totalWarningsIssued))}`)
        console.log(`  MUST constraint hits       ${chalk.red.bold(String(m.checkChange.totalMustConstraintHits))}  ${chalk.gray("(potential regressions prevented)")}`)
        console.log(`  Unique files checked       ${chalk.white(String(m.checkChange.uniqueFilesChecked))}`)
      }

      console.log("")
      console.log(divider)
      console.log("")
      console.log(chalk.bold("  COVERAGE"))
      console.log("")

      console.log(`  Decisions per protected file  ${chalk.bold.white(String(m.coverage.decisionsPerProtectedFile))}`)
      console.log(`  Agent hint density            ${chalk.white(String(m.coverage.agentHintDensity))}  ${chalk.gray("hints per decision")}`)
      console.log("")

      if (total > 0) {
        console.log(divider)
        console.log("")
        console.log(chalk.bold("  DECISION TYPES"))
        console.log("")
        const types = Object.entries(m.decisions.byType).sort((a, b) => b[1] - a[1])
        for (const [type, count] of types) {
          console.log(`  ${type.padEnd(16)} ${bar(count, total, 16)}  ${chalk.white(String(count))}`)
        }
        console.log("")
        console.log(chalk.bold("  CONFIDENCE LEVELS"))
        console.log("")
        const confs = Object.entries(m.decisions.byConfidence).sort((a, b) => b[1] - a[1])
        for (const [conf, count] of confs) {
          const color = conf === "definitive" ? chalk.green : conf === "provisional" ? chalk.yellow : chalk.gray
          console.log(`  ${conf.padEnd(16)} ${bar(count, total, 16)}  ${color(String(count))}`)
        }
      }

      console.log("")
    })
}
