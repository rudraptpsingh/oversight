#!/usr/bin/env node
/**
 * Auto-setup when Oversight is installed as a project dependency.
 * - Initializes .oversight/ non-interactively (skips if already exists)
 * - Creates Cursor rule so agents use Oversight tools
 * - Skips for global installs or when .oversight already exists
 */
import fs from "fs"
import path from "path"
import { execSync } from "child_process"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function getProjectRoot() {
  // npm sets INIT_CWD to the dir where the user ran npm install (the project root)
  if (process.env.INIT_CWD) {
    return path.resolve(process.env.INIT_CWD)
  }
  const cwd = process.cwd()
  const pkgDir = path.resolve(__dirname, "..")
  const pkgName = path.basename(pkgDir)
  if (pkgName === "oversight" && cwd.includes("node_modules")) {
    return path.resolve(cwd, "..", "..")
  }
  return cwd
}

function getGitAuthor() {
  try {
    return execSync("git config user.name", { encoding: "utf-8" }).trim() || "unknown"
  } catch {
    return "unknown"
  }
}

const RULE_CONTENT = `---
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

function ensureCursorIntegration(projectRoot) {
  const mcpDir = path.join(projectRoot, ".cursor")
  if (!fs.existsSync(mcpDir)) fs.mkdirSync(mcpDir, { recursive: true })
  const cursorRulesDir = path.join(projectRoot, ".cursor", "rules")
  const rulePath = path.join(cursorRulesDir, "oversight.mdc")
  if (!fs.existsSync(rulePath)) {
    fs.mkdirSync(cursorRulesDir, { recursive: true })
    fs.writeFileSync(rulePath, RULE_CONTENT, "utf-8")
  }

  const mcpPath = path.join(mcpDir, "mcp.json")
  const oversightServer = {
    command: "npx",
    args: ["-y", "oversight-mcp"],
    cwd: projectRoot,
  }

  if (!fs.existsSync(mcpPath)) {
    fs.mkdirSync(mcpDir, { recursive: true })
    fs.writeFileSync(
      mcpPath,
      JSON.stringify({ mcpServers: { oversight: oversightServer } }, null, 2),
      "utf-8"
    )
    return true
  }
  try {
    const existing = JSON.parse(fs.readFileSync(mcpPath, "utf-8"))
    if (!existing.mcpServers?.oversight) {
      existing.mcpServers = existing.mcpServers || {}
      existing.mcpServers.oversight = oversightServer
      fs.writeFileSync(mcpPath, JSON.stringify(existing, null, 2), "utf-8")
      return true
    }
  } catch (err) {
    if (process.env.DEBUG_OVERSIGHT_POSTINSTALL) console.error("Oversight postinstall MCP:", err)
  }
  return false
}

async function run() {
  if (process.env.npm_config_global === "true") return

  const projectRoot = getProjectRoot()
  const isGitRepo = fs.existsSync(path.join(projectRoot, ".git"))
  if (!isGitRepo) return

  const oversightDir = path.join(projectRoot, ".oversight")
  const configPath = path.join(oversightDir, "config.json")
  let didInit = false

  if (!fs.existsSync(configPath)) {
    const author = getGitAuthor()
    const pkgRoot = path.resolve(__dirname, "..")
    const { writeConfig } = await import(path.join(pkgRoot, "dist/utils/config.js"))
    const { initDb } = await import(path.join(pkgRoot, "dist/db/schema.js"))

    fs.mkdirSync(oversightDir, { recursive: true })
    writeConfig(
      {
        version: "1.0.0",
        author,
        repoRoot: projectRoot,
        createdAt: new Date().toISOString(),
      },
      projectRoot
    )
    initDb(oversightDir)
    fs.writeFileSync(
      path.join(oversightDir, ".gitignore"),
      "decisions.db-journal\ndecisions.db-shm\ndecisions.db-wal\n",
      "utf-8"
    )
    didInit = true
  }

  const wroteCursor = ensureCursorIntegration(projectRoot)

  if (didInit || wroteCursor) {
    console.log("Oversight: initialized .oversight/ and Cursor integration.")
    console.log("Dashboard: http://localhost:7654 — run `oversight dashboard` to start.")
  }
}

run().catch((err) => {
  if (process.env.DEBUG_OVERSIGHT_POSTINSTALL) console.error("Oversight postinstall:", err)
})
