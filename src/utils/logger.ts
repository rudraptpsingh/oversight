import chalk from "chalk"
import type { WhyCodeRecord } from "../types/index.js"

export const logger = {
  success(msg: string): void {
    console.log(chalk.green("✓") + " " + msg)
  },
  warn(msg: string): void {
    console.log(chalk.yellow("⚠") + " " + msg)
  },
  error(msg: string): void {
    console.log(chalk.red("✗") + " " + msg)
  },
  info(msg: string): void {
    console.log(chalk.blue("ℹ") + " " + msg)
  },
  decision(record: WhyCodeRecord): void {
    console.log("")
    console.log(chalk.bold("─".repeat(60)))
    console.log(chalk.bold.cyan(`  ${record.title}`))
    console.log(chalk.gray(`  ID: ${record.id.slice(0, 8)}...  |  Status: ${record.status}  |  Confidence: ${record.confidence}`))
    console.log(chalk.gray(`  Type: ${record.decisionType}  |  Author: ${record.author}  |  v${record.version}`))
    console.log("")
    if (record.summary) {
      console.log(chalk.bold("  Summary:"))
      console.log(`    ${record.summary}`)
      console.log("")
    }
    if (record.context) {
      console.log(chalk.bold("  Context:"))
      console.log(`    ${record.context}`)
      console.log("")
    }
    if (record.decision) {
      console.log(chalk.bold("  Decision:"))
      console.log(`    ${record.decision}`)
      console.log("")
    }
    if (record.rationale) {
      console.log(chalk.bold("  Rationale:"))
      console.log(`    ${record.rationale}`)
      console.log("")
    }
    if (record.constraints.length > 0) {
      console.log(chalk.bold("  Constraints:"))
      for (const c of record.constraints) {
        const label = c.severity === "must"
          ? chalk.red(`[MUST]`)
          : c.severity === "should"
            ? chalk.yellow(`[SHOULD]`)
            : chalk.gray(`[AVOID]`)
        console.log(`    ${label} ${c.description}`)
        if (c.rationale) console.log(chalk.gray(`         → ${c.rationale}`))
      }
      console.log("")
    }
    if (record.doNotChange.length > 0) {
      console.log(chalk.bold("  Do Not Change:"))
      for (const pattern of record.doNotChange) {
        console.log(chalk.red(`    • ${pattern}`))
      }
      console.log("")
    }
    if (record.agentHints.length > 0) {
      console.log(chalk.bold.magenta("  Agent Hints:"))
      for (const hint of record.agentHints) {
        console.log(chalk.magenta(`    [${hint.scope}] ${hint.instruction}`))
      }
      console.log("")
    }
    if (record.alternatives.length > 0) {
      console.log(chalk.bold("  Alternatives Rejected:"))
      for (const alt of record.alternatives) {
        console.log(`    • ${alt.description}: ${alt.rejectionReason}`)
      }
      console.log("")
    }
    if (record.consequences) {
      console.log(chalk.bold("  Consequences:"))
      console.log(`    ${record.consequences}`)
      console.log("")
    }
    if (record.tags.length > 0) {
      console.log(`  Tags: ${record.tags.map((t) => chalk.cyan(`#${t}`)).join(" ")}`)
    }
    if (record.anchors.length > 0) {
      console.log(`  Anchors: ${record.anchors.map((a) => chalk.underline(a.path + (a.identifier ? ` (${a.identifier})` : ""))).join(", ")}`)
    }
    console.log(chalk.bold("─".repeat(60)))
    console.log("")
  },
  table(rows: Record<string, string>[], columns: string[]): void {
    if (rows.length === 0) {
      console.log(chalk.gray("  (no results)"))
      return
    }
    const widths: Record<string, number> = {}
    for (const col of columns) {
      widths[col] = col.length
    }
    for (const row of rows) {
      for (const col of columns) {
        const val = row[col] ?? ""
        if (val.length > widths[col]) widths[col] = val.length
      }
    }
    const header = columns.map((c) => c.toUpperCase().padEnd(widths[c])).join("  ")
    console.log(chalk.bold(header))
    console.log(chalk.gray("─".repeat(header.length)))
    for (const row of rows) {
      const line = columns.map((c) => (row[c] ?? "").padEnd(widths[c])).join("  ")
      console.log(line)
    }
  },
}
