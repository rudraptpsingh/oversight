/**
 * oversight scan — Extract constraints from code comments and optionally record them.
 *
 * Constraint: Benchmarks directory is excluded by default. benchmarks/ contains
 * run results, fixtures, and scenario definitions — not the project's architectural
 * constraints. Only src/ (and any explicit --dirs) is scanned unless overridden.
 */
import { writeFileSync, mkdirSync } from "fs"
import { join } from "path"
import { Command } from "commander"
import ora from "ora"
import { getOversightDir, readConfig } from "../../utils/config.js"
import { getDb } from "../../db/schema.js"
import { insertDecision, checkForDuplicates } from "../../db/decisions.js"
import {
  scanCodebaseForSnippets,
  extractDecisionsFromCodeSnippets,
  heuristicExtractFromSnippets,
  type CodeSnippet,
} from "../../ai/extractFromCode.js"
import type { OversightRecord } from "../../types/index.js"
import { logger } from "../../utils/logger.js"

export function registerScan(program: Command): void {
  program
    .command("scan")
    .description("Scan codebase for constraint-like comments and extract as Oversight decisions")
    .option("--dry-run", "Scan only; do not insert into DB. Writes report to .oversight/scan-report.md")
    .option("--no-ai", "Skip LLM extraction; use heuristic extraction (works without API key)")
    .option("--dirs <dirs...>", "Directories to scan")
    .option("--no-insert", "Same as --dry-run")
    .action(async (opts: { dryRun?: boolean; noAi?: boolean; dirs?: string[]; insert?: boolean }) => {
      const rootDir = process.cwd()
      // Default: src only. benchmarks/ excluded — holds run results, not architectural constraints.
      const dirs = opts.dirs ?? ["src"]
      const shouldInsert = opts.insert !== false && !opts.dryRun

      let oversightDir: string | null = null
      try {
        oversightDir = getOversightDir()
      } catch {
        if (shouldInsert) {
          logger.error("Oversight not initialized. Run `oversight init` first. Use --dry-run to scan without inserting.")
          process.exit(1)
        }
      }

      const config = oversightDir ? readConfig() : { author: "scan" }

      const scanSpinner = ora("Scanning codebase for constraint-like comments...").start()
      const snippets = scanCodebaseForSnippets(rootDir, dirs)
      scanSpinner.succeed(`Found ${snippets.length} snippet(s) in ${dirs.join(", ")}`)

      if (snippets.length === 0) {
        logger.info("No constraint-like comments found.")
        writeReport(rootDir, [], [], snippets)
        logger.info("Dashboard: http://localhost:7654 (run `oversight dashboard` to start)")
        return
      }

      const useAI = !opts.noAi
      const extractSpinner = ora(
        useAI ? "Extracting decisions with AI..." : "Extracting with heuristics..."
      ).start()
      let records: OversightRecord[]
      if (useAI) {
        try {
          records = await extractDecisionsFromCodeSnippets(snippets, config.author)
          if (records.length === 0 && snippets.length > 0) {
            extractSpinner.warn("AI returned no decisions, using heuristics")
            records = heuristicExtractFromSnippets(snippets, config.author)
          }
        } catch (err) {
          extractSpinner.warn("AI extraction failed, using heuristics")
          records = heuristicExtractFromSnippets(snippets, config.author)
        }
        extractSpinner.succeed(`Extracted ${records.length} decision(s)`)
      } else {
        records = heuristicExtractFromSnippets(snippets, config.author)
        extractSpinner.succeed(`Extracted ${records.length} decision(s) (heuristic)`)
      }

      if (shouldInsert && oversightDir) {
        const db = await getDb(oversightDir)
        let inserted = 0
        let skipped = 0
        for (const rec of records) {
          const dupe = checkForDuplicates(db, rec)
          if (dupe.recommendation === "skip" || dupe.recommendation === "merge") {
            skipped++
            continue
          }
          insertDecision(db, rec)
          inserted++
        }
        logger.success(`Inserted ${inserted} new decision(s), skipped ${skipped} duplicate(s)`)
      }

      writeReport(rootDir, records, dirs, snippets)
      const dashboardPort = 7654
      logger.info(`Dashboard: http://localhost:${dashboardPort} (run \`oversight dashboard\` to start)`)
    })
}

function writeReport(
  rootDir: string,
  records: OversightRecord[],
  dirsScanned: string[],
  snippets: CodeSnippet[]
): void {
  const reportDir = join(rootDir, ".oversight")
  mkdirSync(reportDir, { recursive: true })
  const reportPath = join(reportDir, "scan-report.md")

  const constraintFiles = [...new Set(records.flatMap((r) => r.anchors.map((a) => a.path)))]
  const mustCount = records.reduce((s, r) => s + r.constraints.filter((c) => c.severity === "must").length, 0)
  const shouldCount = records.reduce((s, r) => s + r.constraints.filter((c) => c.severity === "should").length, 0)

  const lines: string[] = [
    "# Oversight Code Scan Report",
    "",
    "**Dashboard:** [http://localhost:7654](http://localhost:7654) — run `oversight dashboard` to start.",
    "",
    "## Executive Summary",
    "",
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Scanned | ${new Date().toISOString()} |`,
    `| Directories | ${dirsScanned.join(", ")} |`,
    `| Snippets found | ${snippets.length} |`,
    `| Decisions extracted | ${records.length} |`,
    `| Files with constraints | ${constraintFiles.length} |`,
    `| MUST constraints | ${mustCount} |`,
    `| SHOULD constraints | ${shouldCount} |`,
    "",
    "### Constraint hotspots",
    "",
    ...constraintFiles.slice(0, 10).map((f) => `- \`${f}\``),
    "",
    "---",
    "",
  ]

  if (snippets.length > 0) {
    lines.push("## Raw Snippets Found", "")
    const byFile = new Map<string, CodeSnippet[]>()
    for (const s of snippets) {
      const list = byFile.get(s.filePath) ?? []
      list.push(s)
      byFile.set(s.filePath, list)
    }
    for (const [file, list] of [...byFile.entries()].sort()) {
      lines.push(`### \`${file}\``, "")
      for (const s of list) {
        lines.push(`- **${s.lineStart}-${s.lineEnd}** (${s.kind}):`, "```", s.text, "```", "")
      }
    }
    lines.push("---", "")
  }

  if (records.length > 0) {
    lines.push("## Extracted Decisions (Constraints)", "")
    for (const r of records) {
      lines.push(`### ${r.title}`, "")
      lines.push(`- **Summary:** ${r.summary}`)
      lines.push(`- **Context:** ${r.context}`)
      lines.push(`- **Decision:** ${r.decision}`)
      if (r.anchors.length > 0) {
        lines.push(`- **Anchors:** ${r.anchors.map((a) => a.path).join(", ")}`)
      }
      if (r.constraints.length > 0) {
        lines.push("", "**Constraints:**", "")
        for (const c of r.constraints) {
          lines.push(`- [${c.severity.toUpperCase()}] ${c.description}`)
          if (c.rationale) lines.push(`  - Rationale: ${c.rationale}`)
        }
      }
      lines.push("")
    }
  }

  writeFileSync(reportPath, lines.join("\n"), "utf-8")
  logger.info(`Report written to ${reportPath}`)
}
