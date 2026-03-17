import Database from "better-sqlite3"
import { extractAllPaths, type DiffFile } from "./diff-parser.js"

/**
 * Compute coverage score for a set of changed files.
 * Returns score 0-100 and any newly uncovered files.
 */
export function computeCoverageDelta(
  dbPath: string,
  files: DiffFile[]
): { coverage_score: number; uncovered_files: string[] } {
  const db = new Database(dbPath, { readonly: true })

  const allPaths = extractAllPaths(files)
  const anchored = new Set<string>()

  const decisions = db.prepare(
    "SELECT anchors_json FROM decisions WHERE status = 'active'"
  ).all() as Array<{ anchors_json: string }>

  for (const d of decisions) {
    const anchors: Array<{ path: string }> = JSON.parse(d.anchors_json)
    for (const a of anchors) anchored.add(a.path.replace(/^\.\//, ""))
  }

  db.close()

  const uncovered_files = allPaths.filter(
    (p) => !([...anchored].some((a) => p.includes(a) || a.includes(p)))
  )

  const coverage_score = allPaths.length > 0
    ? Math.round(((allPaths.length - uncovered_files.length) / allPaths.length) * 100)
    : 100

  return { coverage_score, uncovered_files }
}
