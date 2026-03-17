import fs from "fs"
import path from "path"
import type { OversightConfig, EnforcementConfig } from "../types/index.js"

/**
 * Walk up the directory tree from startDir looking for .oversight/config.json.
 * Always repo-relative — never resolves to a global/home path.
 */
export function findOversightDir(startDir: string = process.cwd()): string | null {
  let current = startDir
  while (true) {
    const candidate = path.join(current, ".oversight")
    if (fs.existsSync(path.join(candidate, "config.json"))) {
      return candidate
    }
    const parent = path.dirname(current)
    if (parent === current) return null
    current = parent
  }
}

export function readConfig(startDir: string = process.cwd()): OversightConfig {
  const oversightDir = findOversightDir(startDir)
  if (!oversightDir) {
    throw new Error("Oversight not initialized. Run `oversight init` first.")
  }
  const raw = fs.readFileSync(path.join(oversightDir, "config.json"), "utf-8")
  return JSON.parse(raw) as OversightConfig
}

export function writeConfig(config: OversightConfig, targetDir: string = process.cwd()): void {
  const oversightDir = path.join(targetDir, ".oversight")
  fs.mkdirSync(oversightDir, { recursive: true })
  fs.writeFileSync(path.join(oversightDir, "config.json"), JSON.stringify(config, null, 2), "utf-8")
}

export function getOversightDir(startDir: string = process.cwd()): string {
  const dir = findOversightDir(startDir)
  if (!dir) {
    throw new Error("Oversight not initialized. Run `oversight init` first.")
  }
  return dir
}

export function getDbPath(startDir: string = process.cwd()): string {
  return path.join(getOversightDir(startDir), "decisions.db")
}

export function readEnforcement(startDir: string = process.cwd()): EnforcementConfig {
  const oversightDir = findOversightDir(startDir)
  if (!oversightDir) return { mode: "advisory", blockOnMustViolation: false, blockOnHighRisk: false }
  const enfPath = path.join(oversightDir, "enforcement.json")
  if (!fs.existsSync(enfPath)) return { mode: "advisory", blockOnMustViolation: false, blockOnHighRisk: false }
  try {
    return JSON.parse(fs.readFileSync(enfPath, "utf-8")) as EnforcementConfig
  } catch {
    return { mode: "advisory", blockOnMustViolation: false, blockOnHighRisk: false }
  }
}

export function writeEnforcement(config: EnforcementConfig, targetDir: string = process.cwd()): void {
  const oversightDir = path.join(targetDir, ".oversight")
  fs.mkdirSync(oversightDir, { recursive: true })
  fs.writeFileSync(path.join(oversightDir, "enforcement.json"), JSON.stringify(config, null, 2), "utf-8")
}
