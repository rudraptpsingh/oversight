import fs from "fs"
import path from "path"

const WHYCODE_MARKER = "# WHYCODE_HOOK"

const HOOK_CONTENT = `#!/bin/sh
${WHYCODE_MARKER}
# This hook was installed by WhyCode. Run "whycode hooks uninstall" to remove it.

CHANGED=$(git diff --name-only HEAD^ HEAD 2>/dev/null || git diff --name-only HEAD 2>/dev/null || echo "")

if [ -z "$CHANGED" ]; then
  exit 0
fi

echo ""
echo "WhyCode: You modified files with recorded decisions."
echo "Run 'whycode check <path>' to review before your next change."
echo ""
echo "Modified files:"
echo "$CHANGED" | while read -r file; do
  echo "  • $file"
done
echo ""
`

export function installHooks(repoRoot: string): void {
  const hooksDir = path.join(repoRoot, ".git", "hooks")
  if (!fs.existsSync(hooksDir)) {
    throw new Error("No .git/hooks directory found. Are you in a git repository?")
  }
  const hookPath = path.join(hooksDir, "post-commit")
  if (fs.existsSync(hookPath)) {
    const existing = fs.readFileSync(hookPath, "utf-8")
    if (existing.includes(WHYCODE_MARKER)) return
    fs.writeFileSync(hookPath, existing + "\n" + HOOK_CONTENT, "utf-8")
  } else {
    fs.writeFileSync(hookPath, HOOK_CONTENT, "utf-8")
  }
  fs.chmodSync(hookPath, 0o755)
}

export function uninstallHooks(repoRoot: string): void {
  const hookPath = path.join(repoRoot, ".git", "hooks", "post-commit")
  if (!fs.existsSync(hookPath)) return
  const content = fs.readFileSync(hookPath, "utf-8")
  if (!content.includes(WHYCODE_MARKER)) return
  const lines = content.split("\n")
  const markerIndex = lines.findIndex((l) => l.includes(WHYCODE_MARKER))
  if (markerIndex <= 1) {
    fs.unlinkSync(hookPath)
  } else {
    const cleaned = lines.slice(0, markerIndex).join("\n").trimEnd() + "\n"
    fs.writeFileSync(hookPath, cleaned, "utf-8")
  }
}
