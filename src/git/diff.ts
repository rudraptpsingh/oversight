import { execSync } from "child_process"

export function getChangedFiles(commitRef: string = "HEAD"): string[] {
  try {
    const output = execSync(`git diff --name-only ${commitRef}^ ${commitRef}`, {
      encoding: "utf-8",
    }).trim()
    return output ? output.split("\n").filter(Boolean) : []
  } catch {
    try {
      const output = execSync(`git diff --name-only ${commitRef}`, {
        encoding: "utf-8",
      }).trim()
      return output ? output.split("\n").filter(Boolean) : []
    } catch {
      return []
    }
  }
}

export function getFilesAboveChurnThreshold(days: number, threshold: number): string[] {
  try {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0]

    const output = execSync(`git log --since="${since}" --name-only --format=""`, {
      encoding: "utf-8",
    }).trim()

    if (!output) return []

    const fileCounts = new Map<string, number>()
    for (const line of output.split("\n")) {
      const f = line.trim()
      if (f) {
        fileCounts.set(f, (fileCounts.get(f) ?? 0) + 1)
      }
    }

    return Array.from(fileCounts.entries())
      .filter(([, count]) => count >= threshold)
      .sort((a, b) => b[1] - a[1])
      .map(([file]) => file)
  } catch {
    return []
  }
}
