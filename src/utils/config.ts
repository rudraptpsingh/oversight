import fs from "fs"
import path from "path"
import type { WhyCodeConfig } from "../types/index.js"

export function findWhycodeDir(startDir: string = process.cwd()): string | null {
  let current = startDir
  while (true) {
    const candidate = path.join(current, ".whycode")
    if (fs.existsSync(path.join(candidate, "config.json"))) {
      return candidate
    }
    const parent = path.dirname(current)
    if (parent === current) return null
    current = parent
  }
}

export function readConfig(startDir: string = process.cwd()): WhyCodeConfig {
  const whycodeDir = findWhycodeDir(startDir)
  if (!whycodeDir) {
    throw new Error("WhyCode not initialized. Run `whycode init` first.")
  }
  const raw = fs.readFileSync(path.join(whycodeDir, "config.json"), "utf-8")
  return JSON.parse(raw) as WhyCodeConfig
}

export function writeConfig(config: WhyCodeConfig, targetDir: string = process.cwd()): void {
  const whycodeDir = path.join(targetDir, ".whycode")
  fs.mkdirSync(whycodeDir, { recursive: true })
  fs.writeFileSync(path.join(whycodeDir, "config.json"), JSON.stringify(config, null, 2), "utf-8")
}

export function getWhycodeDir(startDir: string = process.cwd()): string {
  const dir = findWhycodeDir(startDir)
  if (!dir) {
    throw new Error("WhyCode not initialized. Run `whycode init` first.")
  }
  return dir
}

export function getDbPath(startDir: string = process.cwd()): string {
  return path.join(getWhycodeDir(startDir), "decisions.db")
}
