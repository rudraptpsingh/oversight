import path from "path"
import type { WhyCodeRecord, CodeAnchor } from "../types/index.js"

function normalizePath(p: string): string {
  return p.replace(/^\.\//, "").replace(/\\/g, "/")
}

export function matchesAnchor(record: WhyCodeRecord, filePath: string): boolean {
  const normalizedFile = normalizePath(path.normalize(filePath))
  return record.anchors.some((anchor) => {
    const normalizedAnchor = normalizePath(path.normalize(anchor.path))
    return (
      normalizedAnchor === normalizedFile ||
      normalizedFile.startsWith(normalizedAnchor + "/") ||
      normalizedAnchor.startsWith(normalizedFile + "/")
    )
  })
}

export function formatAnchorsForDisplay(anchors: CodeAnchor[]): string {
  return anchors
    .map((a) => {
      if (a.identifier) return `${a.path} (${a.identifier})`
      if (a.lineRange) return `${a.path}:${a.lineRange[0]}-${a.lineRange[1]}`
      return a.path
    })
    .join(", ")
}
