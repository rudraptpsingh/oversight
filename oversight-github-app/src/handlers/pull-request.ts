import type { Context } from "probot"
import fs from "fs"
import os from "os"
import path from "path"
import { execSync } from "child_process"
import { checkConstraints } from "../analyzer/constraint-checker.js"
import { computeCoverageDelta } from "../analyzer/coverage-scorer.js"
import type { DiffFile } from "../analyzer/diff-parser.js"

const CHECK_NAME = "Oversight Constraints"

/**
 * Download decisions.db from the repo's default branch, run constraint checks,
 * post a GitHub Check Run with results, and comment on the PR if violations found.
 */
export async function handlePullRequest(
  context: Context<"pull_request.opened"> | Context<"pull_request.synchronize">
): Promise<void> {
  const { octokit, payload } = context
  const owner = payload.repository.owner.login
  const repo = payload.repository.name
  const sha = payload.pull_request.head.sha
  const prNumber = payload.pull_request.number

  // Create pending check run
  const { data: checkRun } = await octokit.checks.create({
    owner,
    repo,
    name: CHECK_NAME,
    head_sha: sha,
    status: "in_progress",
    started_at: new Date().toISOString(),
  })

  try {
    // Get changed files
    const { data: filesData } = await octokit.pulls.listFiles({
      owner,
      repo,
      pull_number: prNumber,
      per_page: 100,
    })

    const files: DiffFile[] = filesData.map((f) => ({
      filename: f.filename,
      status: f.status as DiffFile["status"],
      previous_filename: f.previous_filename,
    }))

    if (files.length === 0) {
      await completeCheckRun(octokit, owner, repo, checkRun.id, "success", "No files changed.", "")
      return
    }

    // Download decisions.db from base branch
    const dbPath = await downloadDecisionsDb(octokit, owner, repo, payload.pull_request.base.ref)

    if (!dbPath) {
      await completeCheckRun(
        octokit, owner, repo, checkRun.id,
        "neutral",
        "No decisions.db found in this repository.",
        "Run `oversight init` and commit decisions to enable constraint checking."
      )
      return
    }

    const changeDesc = `PR #${prNumber}: ${payload.pull_request.title}`
    const { violations, warnings, riskLevel } = checkConstraints(dbPath, files, changeDesc)
    const { coverage_score, uncovered_files } = computeCoverageDelta(dbPath, files)

    // Clean up temp file
    try { fs.unlinkSync(dbPath) } catch { /* best-effort */ }

    const hasViolations = violations.length > 0
    const conclusion = hasViolations ? "failure" : "success"

    // Build summary
    const summaryLines: string[] = [
      `## Oversight Constraint Check`,
      ``,
      `| Metric | Value |`,
      `|--------|-------|`,
      `| Risk level | ${riskLevel.toUpperCase()} |`,
      `| Violations | ${violations.length} |`,
      `| Warnings | ${warnings.length} |`,
      `| PR file coverage | ${coverage_score}% |`,
    ]

    if (violations.length > 0) {
      summaryLines.push(``, `### ❌ Violations (${violations.length})`, ``)
      for (const v of violations) {
        summaryLines.push(
          `**[${v.severity}]** \`${v.file}\``,
          `> ${v.constraint}`,
          `> _From decision: ${v.decisionTitle} (\`${v.decisionId}\`)_`,
          `> Rationale: ${v.rationale}`,
          ``
        )
      }
    }

    if (warnings.length > 0) {
      summaryLines.push(``, `### ⚠️ Warnings`, ``)
      for (const w of warnings) {
        summaryLines.push(`- ${w}`)
      }
    }

    if (uncovered_files.length > 0) {
      summaryLines.push(``, `### 📁 Uncovered files`, ``)
      for (const f of uncovered_files.slice(0, 10)) {
        summaryLines.push(`- \`${f}\` — no anchored decision`)
      }
      if (uncovered_files.length > 10) {
        summaryLines.push(`- _...and ${uncovered_files.length - 10} more_`)
      }
    }

    const title = hasViolations
      ? `${violations.length} constraint violation(s) found`
      : warnings.length > 0
        ? `${warnings.length} warning(s) — no blocking violations`
        : `All constraints satisfied`

    await completeCheckRun(octokit, owner, repo, checkRun.id, conclusion, title, summaryLines.join("\n"))

    // Post PR comment if violations found
    if (hasViolations) {
      const commentLines = [
        `## ⛔ Oversight: Constraint Violations`,
        ``,
        `This PR modifies files that violate **${violations.length}** MUST constraint(s):`,
        ``,
      ]
      for (const v of violations.slice(0, 5)) {
        commentLines.push(`- **${v.constraint}** (\`${v.file}\`)`)
      }
      if (violations.length > 5) {
        commentLines.push(`- _...and ${violations.length - 5} more — see Check Run for full list_`)
      }
      commentLines.push(``, `Run \`oversight check <file>\` locally to review constraints.`)

      await octokit.issues.createComment({
        owner,
        repo,
        issue_number: prNumber,
        body: commentLines.join("\n"),
      })
    }
  } catch (err) {
    context.log.error(`Oversight check failed: ${String(err)}`)
    await completeCheckRun(
      octokit, owner, repo, checkRun.id,
      "neutral",
      "Oversight check could not complete",
      `Error: ${String(err)}`
    )
  }
}

async function completeCheckRun(
  octokit: Context["octokit"],
  owner: string,
  repo: string,
  checkRunId: number,
  conclusion: "success" | "failure" | "neutral",
  title: string,
  summary: string
): Promise<void> {
  await octokit.checks.update({
    owner,
    repo,
    check_run_id: checkRunId,
    status: "completed",
    completed_at: new Date().toISOString(),
    conclusion,
    output: { title, summary },
  })
}

async function downloadDecisionsDb(
  octokit: Context["octokit"],
  owner: string,
  repo: string,
  ref: string
): Promise<string | null> {
  try {
    const { data } = await octokit.repos.getContent({
      owner,
      repo,
      path: ".oversight/decisions.db",
      ref,
    })

    if (!("content" in data) || !data.content) return null

    const buf = Buffer.from(data.content, "base64")
    const tmpPath = path.join(os.tmpdir(), `oversight-${owner}-${repo}-${Date.now()}.db`)
    fs.writeFileSync(tmpPath, buf)
    return tmpPath
  } catch {
    // File not found or not accessible
    return null
  }
}
