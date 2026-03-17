import fs from "fs"
import path from "path"

const OVERSIGHT_MARKER = "# OVERSIGHT_HOOK"

const POST_COMMIT_CONTENT = `#!/bin/sh
${OVERSIGHT_MARKER}
# This hook was installed by Oversight. Run "oversight hooks uninstall" to remove it.

CHANGED=$(git diff --name-only HEAD^ HEAD 2>/dev/null || git diff --name-only HEAD 2>/dev/null || echo "")

if [ -z "$CHANGED" ]; then
  exit 0
fi

# Run self-check to update session-report.json (non-blocking)
npx tsx scripts/self-check.ts 2>/dev/null || true

echo ""
echo "Oversight: You modified files with recorded decisions."
echo "Run 'oversight check <path>' to review before your next change."
echo ""
echo "Modified files:"
echo "$CHANGED" | while read -r file; do
  echo "  • $file"
done
echo ""
`

const PRE_COMMIT_CONTENT = `#!/bin/sh
${OVERSIGHT_MARKER}_ENFORCE
# Pre-commit: Oversight constraint check. Run "oversight hooks uninstall --enforce" to remove.
npx oversight enforce staged
`

function writeHook(hookPath: string, content: string, marker: string): void {
  if (fs.existsSync(hookPath)) {
    const existing = fs.readFileSync(hookPath, "utf-8")
    if (existing.includes(marker)) return
    fs.writeFileSync(hookPath, existing + "\n" + content, "utf-8")
  } else {
    fs.writeFileSync(hookPath, content, "utf-8")
  }
  fs.chmodSync(hookPath, 0o755)
}

export function installHooks(repoRoot: string): void {
  const hooksDir = path.join(repoRoot, ".git", "hooks")
  if (!fs.existsSync(hooksDir)) {
    throw new Error("No .git/hooks directory found. Are you in a git repository?")
  }
  writeHook(path.join(hooksDir, "post-commit"), POST_COMMIT_CONTENT, OVERSIGHT_MARKER)
}

export function installEnforceHook(repoRoot: string): void {
  const hooksDir = path.join(repoRoot, ".git", "hooks")
  if (!fs.existsSync(hooksDir)) {
    throw new Error("No .git/hooks directory found. Are you in a git repository?")
  }
  writeHook(path.join(hooksDir, "pre-commit"), PRE_COMMIT_CONTENT, OVERSIGHT_MARKER + "_ENFORCE")
}

export function uninstallHooks(repoRoot: string): void {
  const hookPath = path.join(repoRoot, ".git", "hooks", "post-commit")
  if (!fs.existsSync(hookPath)) return
  const content = fs.readFileSync(hookPath, "utf-8")
  if (!content.includes(OVERSIGHT_MARKER)) return
  const lines = content.split("\n")
  const markerIndex = lines.findIndex((l) => l.includes(OVERSIGHT_MARKER))
  if (markerIndex <= 1) {
    fs.unlinkSync(hookPath)
  } else {
    const cleaned = lines.slice(0, markerIndex).join("\n").trimEnd() + "\n"
    fs.writeFileSync(hookPath, cleaned, "utf-8")
  }
}

export function uninstallEnforceHook(repoRoot: string): void {
  const hookPath = path.join(repoRoot, ".git", "hooks", "pre-commit")
  if (!fs.existsSync(hookPath)) return
  const content = fs.readFileSync(hookPath, "utf-8")
  if (!content.includes(OVERSIGHT_MARKER + "_ENFORCE")) return
  const lines = content.split("\n")
  const markerIndex = lines.findIndex((l) => l.includes(OVERSIGHT_MARKER + "_ENFORCE"))
  if (markerIndex <= 1) {
    fs.unlinkSync(hookPath)
  } else {
    const cleaned = lines.slice(0, markerIndex).join("\n").trimEnd() + "\n"
    fs.writeFileSync(hookPath, cleaned, "utf-8")
  }
}
