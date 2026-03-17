import Database from "better-sqlite3"
import { extractAffectedPaths, type DiffFile } from "./diff-parser.js"

interface RawConstraint {
  description: string
  severity: string
  rationale: string
}

interface RawDecision {
  id: string
  title: string
  anchors_json: string
  constraints_json: string
  do_not_change_json: string
}

interface Violation {
  file: string
  constraint: string
  severity: string
  decisionId: string
  decisionTitle: string
  rationale: string
}

/**
 * Run constraint checks against a downloaded decisions.db for a set of changed files.
 * Returns violations and warnings.
 */
export function checkConstraints(
  dbPath: string,
  files: DiffFile[],
  changeDescription: string
): { violations: Violation[]; warnings: string[]; riskLevel: "low" | "medium" | "high" } {
  const db = new Database(dbPath, { readonly: true })
  const affectedPaths = extractAffectedPaths(files)

  const allDecisions = db.prepare(
    "SELECT id, title, anchors_json, constraints_json, do_not_change_json FROM decisions WHERE status = 'active'"
  ).all() as RawDecision[]

  const violations: Violation[] = []
  const warnings: string[] = []

  for (const decision of allDecisions) {
    const anchors: Array<{ type: string; path: string; glob?: string }> = JSON.parse(decision.anchors_json)
    const constraints: RawConstraint[] = JSON.parse(decision.constraints_json)
    const doNotChange: string[] = JSON.parse(decision.do_not_change_json)

    const matchedFiles = affectedPaths.filter((filePath) =>
      anchors.some((anchor) => {
        const anchorPath = anchor.path.replace(/^\.\//, "").replace(/\\/g, "/")
        const normalized = filePath.replace(/^\.\//, "").replace(/\\/g, "/")
        return (
          anchorPath === normalized ||
          normalized.startsWith(anchorPath + "/") ||
          anchorPath.startsWith(normalized + "/")
        )
      })
    )

    if (matchedFiles.length === 0) continue

    for (const c of constraints) {
      if (c.severity === "must") {
        for (const file of matchedFiles) {
          violations.push({
            file,
            constraint: c.description,
            severity: "MUST",
            decisionId: decision.id,
            decisionTitle: decision.title,
            rationale: c.rationale,
          })
        }
      } else if (c.severity === "should") {
        warnings.push(`[SHOULD] ${c.description} (from "${decision.title}")`)
      }
    }

    for (const pattern of doNotChange) {
      if (matchedFiles.some((f) => f.includes(pattern) || pattern.includes(f))) {
        warnings.push(`Do-not-change pattern matched: "${pattern}" (from "${decision.title}")`)
      }
    }
  }

  db.close()

  let riskLevel: "low" | "medium" | "high" = "low"
  if (violations.length > 0) riskLevel = "high"
  else if (warnings.length > 0) riskLevel = "medium"

  return { violations, warnings, riskLevel }
}
