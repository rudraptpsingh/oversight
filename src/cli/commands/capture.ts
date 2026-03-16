import { Command } from "commander"
import inquirer from "inquirer"
import ora from "ora"
import { v4 as uuidv4 } from "uuid"
import { getOversightDir, readConfig } from "../../utils/config.js"
import { getDb } from "../../db/schema.js"
import { insertDecision } from "../../db/decisions.js"
import { logger } from "../../utils/logger.js"
import { expandWithAI } from "../../ai/capture.js"
import type { OversightRecord, DecisionType, Confidence, CodeAnchor, AgentHint } from "../../types/index.js"
import type { Database } from "../../db/schema.js"

export function registerCapture(program: Command): void {
  program
    .command("capture")
    .description("Record a new code decision")
    .option("--ai", "Use AI to expand a rough note into a full record")
    .action(async (opts: { ai?: boolean }) => {
      const oversightDir = getOversightDir()
      const config = readConfig()
      const db = await getDb(oversightDir)

      if (opts.ai) {
        await captureWithAI(db, config.author)
      } else {
        await captureManual(db, config.author)
      }
    })
}

async function captureManual(db: Database, author: string): Promise<void> {
  const answers = await inquirer.prompt([
    { type: "input", name: "title", message: "Decision title:", validate: (v: string) => v.trim().length > 0 || "Title is required" },
    { type: "list", name: "decisionType", message: "Decision type:", choices: ["architectural","algorithmic","security","performance","compatibility","compliance","business-logic","workaround","deferred"] },
    { type: "input", name: "summary", message: "One-line summary:", validate: (v: string) => v.trim().length > 0 || "Summary is required" },
    { type: "editor", name: "context", message: "Context (why was this decision needed?):" },
    { type: "editor", name: "decision", message: "Decision (what was decided?):" },
    { type: "editor", name: "rationale", message: "Rationale (why this over alternatives?):" },
    { type: "input", name: "consequences", message: "Consequences:" },
    { type: "input", name: "anchors", message: "File paths (comma-separated):" },
    { type: "input", name: "tags", message: "Tags (comma-separated):" },
    { type: "list", name: "confidence", message: "Confidence level:", choices: ["definitive", "provisional", "exploratory"] },
    { type: "input", name: "doNotChange", message: "Do-not-change regex patterns (comma-separated, optional):" },
    { type: "input", name: "agentHints", message: "Agent hints (one instruction, optional):" },
  ])

  const anchors: CodeAnchor[] = answers.anchors
    ? answers.anchors.split(",").map((p: string) => p.trim()).filter(Boolean).map((p: string) => ({ type: "file" as const, path: p }))
    : []

  const tags: string[] = answers.tags
    ? answers.tags.split(",").map((t: string) => t.trim()).filter(Boolean)
    : []

  const doNotChange: string[] = answers.doNotChange
    ? answers.doNotChange.split(",").map((p: string) => p.trim()).filter(Boolean)
    : []

  const agentHints: AgentHint[] = answers.agentHints
    ? [{ instruction: answers.agentHints.trim(), scope: "file" as const }]
    : []

  const record: OversightRecord = {
    id: uuidv4(), version: 1, status: "active", anchors, title: answers.title.trim(),
    summary: answers.summary.trim(), context: answers.context?.trim() ?? "",
    decision: answers.decision?.trim() ?? "", rationale: answers.rationale?.trim() ?? "",
    constraints: [], alternatives: [], consequences: answers.consequences?.trim() ?? "",
    tags, decisionType: answers.decisionType as DecisionType, confidence: answers.confidence as Confidence,
    author, timestamp: new Date().toISOString(), agentHints, doNotChange, reviewTriggers: [],
  }

  insertDecision(db, record)
  logger.success(`Decision recorded: ${record.id.slice(0, 8)}`)
  logger.decision(record)
  logger.info("Dashboard: http://localhost:7654 — run `oversight dashboard` to view")
}

async function captureWithAI(db: Database, author: string): Promise<void> {
  const { roughNote } = await inquirer.prompt([
    { type: "input", name: "roughNote", message: "Describe the decision in a sentence:", validate: (v: string) => v.trim().length > 0 || "Please enter a description" },
  ])

  const spinner = ora("Expanding with AI...").start()
  let record: OversightRecord
  try {
    record = await expandWithAI(roughNote.trim(), author)
    spinner.succeed("AI expanded your note into a full decision record")
  } catch (err) {
    spinner.fail("AI expansion failed")
    logger.error(String(err))
    return
  }

  logger.decision(record)

  const { action } = await inquirer.prompt([
    { type: "list", name: "action", message: "What would you like to do?", choices: [{ name: "Save this record", value: "save" }, { name: "Cancel", value: "cancel" }] },
  ])

  if (action === "save") {
    insertDecision(db, record)
    logger.success(`Decision saved: ${record.id.slice(0, 8)}`)
    logger.info("Dashboard: http://localhost:7654 — run `oversight dashboard` to view")
  } else {
    logger.info("Cancelled.")
  }
}
