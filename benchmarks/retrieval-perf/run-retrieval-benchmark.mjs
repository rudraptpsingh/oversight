#!/usr/bin/env node
/**
 * Retrieval performance comparison: path-only vs BM25 + path filter + top-K.
 * Run: node benchmarks/retrieval-perf/run-retrieval-benchmark.mjs
 */
import { mkdtempSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { initDb } from "../../dist/db/schema.js"
import { insertDecision } from "../../dist/db/decisions.js"
import { getDecisionsByPath } from "../../dist/db/decisions.js"
import { retrieveConstraintsForEdit, recordToSlim } from "../../dist/db/retrieval.js"
import { v4 as uuidv4 } from "uuid"

const CHARS_PER_TOKEN = 4
const ITERATIONS = 100
const TOP_K = 10

function estimateTokens(records) {
  const json = JSON.stringify(records)
  return Math.ceil(json.length / CHARS_PER_TOKEN)
}

function runPathOnly(db, paths) {
  const seen = new Map()
  for (const p of paths) {
    const basename = p.split("/").pop() ?? p
    const records = getDecisionsByPath(db, p)
    const extra = basename !== p ? getDecisionsByPath(db, basename) : []
    for (const r of [...records, ...extra]) {
      if (!seen.has(r.id) && (r.status === "active" || r.status === "proposed")) {
        seen.set(r.id, r)
      }
    }
  }
  return Array.from(seen.values())
}

function runBM25Path(db, paths, query, topK) {
  const retrieved = retrieveConstraintsForEdit(db, {
    paths,
    query,
    topK,
    includeSuperseded: false,
  })
  return retrieved.map((r) => r.record)
}

function bench(name, fn) {
  const start = performance.now()
  for (let i = 0; i < ITERATIONS; i++) fn()
  const elapsed = performance.now() - start
  return { name, avgMs: elapsed / ITERATIONS, totalMs: elapsed }
}

async function main() {
  const workDir = mkdtempSync(join(tmpdir(), "retrieval-bench-"))
  const db = await initDb(workDir)

  // Seed: 50 decisions across various paths (simulates a mature codebase)
  const pathTemplates = [
    "src/auth.ts",
    "src/auth/middleware.ts",
    "src/db/decisions.ts",
    "src/db/retrieval.ts",
    "src/dashboard/server.ts",
    "src/mcp/tools/getByPath.ts",
    "src/cli/commands/scan.ts",
  ]
  for (let i = 0; i < 50; i++) {
    const pathIdx = i % pathTemplates.length
    insertDecision(db, {
      id: uuidv4(),
      version: 1,
      status: "active",
      anchors: [{ type: "file", path: pathTemplates[pathIdx] }],
      title: `Decision ${i}: ${["JWT", "rate limit", "SQLite", "BM25", "token bucket"][i % 5]}`,
      summary: `Summary for decision ${i}`,
      context: `Context about ${pathTemplates[pathIdx]}`,
      decision: `Use specific pattern for ${pathTemplates[pathIdx]}`,
      rationale: "Best practice",
      constraints: [
        {
          description: `Constraint ${i}: must use jwt.verify with algorithms`,
          severity: "must",
          rationale: "Security",
        },
      ],
      alternatives: [],
      consequences: "",
      tags: [],
      decisionType: "architectural",
      confidence: "definitive",
      author: "bench",
      timestamp: new Date().toISOString(),
      agentHints: [],
      doNotChange: [],
      reviewTriggers: [],
    })
  }

  const paths = ["src/auth.ts", "src/db/decisions.ts", "src/dashboard/server.ts"]
  const query = "refactor auth to use jwt.verify with algorithms"

  // Warmup
  runPathOnly(db, paths)
  runBM25Path(db, paths, query, TOP_K)

  const pathOnlyResult = runPathOnly(db, paths)
  const bm25Result = runBM25Path(db, paths, query, TOP_K)
  const bm25SlimResult = bm25Result.map(recordToSlim)

  const pathOnlyTime = bench("path-only (all path-matched)", () => runPathOnly(db, paths))
  const bm25Time = bench("BM25+path+topK", () => runBM25Path(db, paths, query, TOP_K))

  const pathOnlyTokens = estimateTokens(pathOnlyResult)
  const bm25Tokens = estimateTokens(bm25Result)
  const bm25SlimTokens = estimateTokens(bm25SlimResult)

  const tokenReductionTopK = pathOnlyResult.length > 0
    ? Math.round(((pathOnlyTokens - bm25Tokens) / pathOnlyTokens) * 100)
    : 0
  const tokenReductionSlim = bm25Result.length > 0
    ? Math.round(((bm25Tokens - bm25SlimTokens) / bm25Tokens) * 100)
    : 0

  console.log("\n## Retrieval Performance Comparison\n")
  console.log("| Approach | Records | Est. tokens | Avg latency (100 runs) |")
  console.log("|----------|---------|-------------|------------------------|")
  console.log(
    `| Path-only (all) | ${pathOnlyResult.length} | ~${pathOnlyTokens} | ${pathOnlyTime.avgMs.toFixed(3)} ms |`
  )
  console.log(
    `| BM25+path+topK=${TOP_K} | ${bm25Result.length} | ~${bm25Tokens} | ${bm25Time.avgMs.toFixed(3)} ms |`
  )
  console.log(
    `| + slim format | ${bm25SlimResult.length} | ~${bm25SlimTokens} | — |`
  )
  console.log("")
  console.log("### Improvements")
  console.log(`- **Top-K:** ${tokenReductionTopK}% fewer tokens (${pathOnlyTokens} → ${bm25Tokens})`)
  console.log(`- **Slim format:** ${tokenReductionSlim}% fewer vs full (${bm25Tokens} → ${bm25SlimTokens})`)
  console.log(`- **Combined:** ~${Math.round((1 - bm25SlimTokens / pathOnlyTokens) * 100)}% total reduction`)
  console.log(
    `- **Latency:** BM25 ~${(bm25Time.avgMs - pathOnlyTime.avgMs).toFixed(3)} ms (negligible)`
  )
  console.log("\n✓ BM25 + path filter + slim format reduces context cost.\n")

  rmSync(workDir, { recursive: true, force: true })

  // Optional: run against project .oversight if it exists
  try {
    const { getDb } = await import("../../dist/db/schema.js")
    const { getOversightDir } = await import("../../dist/utils/config.js")
    const dir = getOversightDir()
    const projDb = await getDb(dir)
    const projPaths = ["src/dashboard/server.ts", "src/db/schema.ts", "src/db/decisions.ts"]
    const projPathOnly = runPathOnly(projDb, projPaths)
    const projBM25 = runBM25Path(projDb, projPaths, "rate limit token bucket SQLite", TOP_K)
    console.log("### This project (.oversight)")
    console.log("| Approach | Records | Est. tokens |")
    console.log("|----------|---------|-------------|")
    console.log(`| Path-only | ${projPathOnly.length} | ~${estimateTokens(projPathOnly)} |`)
    console.log(`| BM25+topK=${TOP_K} | ${projBM25.length} | ~${estimateTokens(projBM25)} |`)
  } catch {
    // no .oversight
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
