/**
 * Parse a GitHub PR diff into a list of affected file paths.
 */
export interface DiffFile {
  filename: string
  status: "added" | "modified" | "removed" | "renamed"
  previous_filename?: string
}

export function extractAffectedPaths(files: DiffFile[]): string[] {
  return files
    .filter((f) => f.status !== "removed")
    .map((f) => f.filename)
}

export function extractAllPaths(files: DiffFile[]): string[] {
  const paths = new Set<string>()
  for (const f of files) {
    paths.add(f.filename)
    if (f.previous_filename) paths.add(f.previous_filename)
  }
  return [...paths]
}
