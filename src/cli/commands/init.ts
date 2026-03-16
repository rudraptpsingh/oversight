import { Command } from "commander"
import inquirer from "inquirer"
import { execSync } from "child_process"
import fs from "fs"
import path from "path"
import { writeConfig, findOversightDir } from "../../utils/config.js"
import { initDb } from "../../db/schema.js"
import { logger } from "../../utils/logger.js"

function getGitAuthor(): string {
  try {
    return execSync("git config user.name", { encoding: "utf-8" }).trim()
  } catch {
    return ""
  }
}

const CURSOR_RULE = `---
description: Use Oversight to record and enforce architectural decisions
globs: 
alwaysApply: true
---

# Oversight — Decision Memory

Before editing files involved in architecture or security, call Oversight MCP tools:

1. **Before significant changes**: Call \`oversight_check_change\` with the change description and affected paths.
2. **When making architectural decisions**: Call \`oversight_record\` to store the decision with constraints and anchors.
3. **Before editing a file**: Call \`oversight_get_by_path\` to surface anchored decisions.
4. **When unsure**: Call \`oversight_search\` to find relevant past decisions.

Respect MUST constraints. If \`oversight_check_change\` returns high risk, revise the change or get explicit approval.
`

export async function ensureInitNonInteractive(cwd: string = process.cwd()): Promise<boolean> {
  const oversightDir = path.join(cwd, ".oversight")
  const configPath = path.join(oversightDir, "config.json")
  if (fs.existsSync(configPath)) return false
  const author = getGitAuthor() || "unknown"
  fs.mkdirSync(oversightDir, { recursive: true })
  writeConfig(
    { version: "1.0.0", author, repoRoot: cwd, createdAt: new Date().toISOString() },
    cwd
  )
  await initDb(oversightDir)
  fs.writeFileSync(
    path.join(oversightDir, ".gitignore"),
    "decisions.db-journal\ndecisions.db-shm\ndecisions.db-wal\n",
    "utf-8"
  )
  ensureCursorIntegration(cwd)
  return true
}

export function ensureCursorIntegration(cwd: string): void {
  const rulesDir = path.join(cwd, ".cursor", "rules")
  const rulePath = path.join(rulesDir, "oversight.mdc")
  if (!fs.existsSync(rulePath)) {
    fs.mkdirSync(rulesDir, { recursive: true })
    fs.writeFileSync(rulePath, CURSOR_RULE, "utf-8")
  }
  const mcpPath = path.join(cwd, ".cursor", "mcp.json")
  let wrote = false
  if (!fs.existsSync(mcpPath)) {
    fs.mkdirSync(path.dirname(mcpPath), { recursive: true })
    fs.writeFileSync(
      mcpPath,
      JSON.stringify(
        {
          mcpServers: {
            oversight: {
              command: "npx",
              args: ["-y", "oversight-mcp"],
              cwd,
            },
          },
        },
        null,
        2
      ),
      "utf-8"
    )
    wrote = true
  } else {
    try {
      const existing = JSON.parse(fs.readFileSync(mcpPath, "utf-8"))
      if (!existing.mcpServers?.oversight) {
        existing.mcpServers = existing.mcpServers || {}
        existing.mcpServers.oversight = { command: "npx", args: ["-y", "oversight-mcp"], cwd }
        fs.writeFileSync(mcpPath, JSON.stringify(existing, null, 2), "utf-8")
        wrote = true
      }
    } catch {
      /* ignore */
    }
  }
  if (wrote) {
    logger.info("Created .cursor/rules/oversight.mdc and .cursor/mcp.json — restart Cursor to load MCP.")
  }
}

export function registerInit(program: Command): void {
  program
    .command("init")
    .description("Initialize Oversight in the current repository")
    .option("-y, --yes", "Non-interactive: use git author, skip prompts")
    .action(async (opts: { yes?: boolean }) => {
      const cwd = process.cwd()
      const existing = findOversightDir(cwd)
      const isReinit = existing === path.join(cwd, ".oversight")

      if (isReinit && !opts.yes) {
        const { confirm } = await inquirer.prompt([
          {
            type: "confirm",
            name: "confirm",
            message: "Oversight is already initialized. Reinitialize?",
            default: false,
          },
        ])
        if (!confirm) {
          logger.info("Aborted.")
          return
        }
      }

      if (isReinit && opts.yes) {
        logger.info("Already initialized. Use without --yes to reinitialize interactively.")
        return
      }

      const resolvedAuthor = opts.yes
        ? (getGitAuthor() || "unknown")
        : (
            await inquirer.prompt([
              {
                type: "input",
                name: "author",
                message: "Author name:",
                default: getGitAuthor(),
                validate: (v: string) => v.trim().length > 0 || "Author name is required",
              },
            ])
          ).author

      const oversightDir = path.join(cwd, ".oversight")
      fs.mkdirSync(oversightDir, { recursive: true })

      writeConfig(
        {
          version: "1.0.0",
          author: resolvedAuthor.trim(),
          repoRoot: cwd,
          createdAt: new Date().toISOString(),
        },
        cwd
      )

      await initDb(oversightDir)

      fs.writeFileSync(
        path.join(oversightDir, ".gitignore"),
        "decisions.db-journal\ndecisions.db-shm\ndecisions.db-wal\n",
        "utf-8"
      )

      ensureCursorIntegration(cwd)

      logger.success("Oversight initialized successfully!")
      console.log("")
      logger.info("Next steps:")
      console.log("  • oversight capture          — record a decision")
      console.log("  • oversight list             — view all decisions")
      console.log("  • oversight dashboard        — open visual UI at http://localhost:7654")
      console.log("  • oversight check <path>     — check decisions for a file")
      console.log("  • oversight hooks install    — enable git post-commit reminders")
      console.log("")
    })
}
