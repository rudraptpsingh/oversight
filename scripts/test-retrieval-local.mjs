#!/usr/bin/env node
/**
 * Local test of BM25 + path-filter retrieval (no API key needed).
 * Usage: node scripts/test-retrieval-local.mjs
 */
import { mkdtempSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { initDb } from "../dist/db/schema.js"
import { insertDecision } from "../dist/db/decisions.js"
import { retrieveConstraintsForEdit } from "../dist/db/retrieval.js"
import { handleGetByPath } from "../dist/mcp/tools/getByPath.js"
import { handleCheckChange } from "../dist/mcp/tools/checkChange.js"
import { handleRetrieveConstraints } from "../dist/mcp/tools/retrieveConstraints.js"
import { handleSessionStart } from "../dist/mcp/tools/sessionStart.js"
import { v4 as uuidv4 } from "uuid"

const workDir = mkdtempSync(join(tmpdir(), "oversight-retrieval-test-"))

async function main() {
  const db = await initDb(workDir)

  // Insert test records
  insertDecision(db, {
    id: "r1",
    version: 1,
    status: "active",
    anchors: [{ type: "file", path: "src/auth.ts" }],
    title: "JWT verification",
    summary: "Use jwt.verify with algorithms",
    context: "",
    decision: "Always use jwt.verify with algorithms specified",
    rationale: "Security",
    constraints: [{ description: "Must use jwt.verify", severity: "must", rationale: "Prevent algo confusion" }],
    alternatives: [],
    consequences: "",
    tags: [],
    decisionType: "security",
    confidence: "definitive",
    author: "test",
    timestamp: new Date().toISOString(),
    agentHints: [],
    doNotChange: [],
    reviewTriggers: [],
  })
  insertDecision(db, {
    id: "r2",
    version: 1,
    status: "active",
    anchors: [{ type: "file", path: "src/db/retrieval.ts" }],
    title: "BM25 retrieval",
    summary: "Path filter and BM25 ranking",
    context: "",
    decision: "Use BM25 for constraint retrieval",
    rationale: "Fast, cheap",
    constraints: [],
    alternatives: [],
    consequences: "",
    tags: [],
    decisionType: "architectural",
    confidence: "provisional",
    author: "test",
    timestamp: new Date().toISOString(),
    agentHints: [],
    doNotChange: [],
    reviewTriggers: [],
  })

  console.log("1. retrieveConstraintsForEdit(paths, query)")
  const retrieved = retrieveConstraintsForEdit(db, {
    paths: ["src/auth.ts", "src/db/retrieval.ts"],
    query: "jwt verify",
    topK: 5,
  })
  console.log("   Records:", retrieved.length)
  console.log("   Top match:", retrieved[0]?.record?.title, "score:", retrieved[0]?.score?.toFixed(2))

  console.log("\n2. handleGetByPath (with optional query)")
  const byPath = handleGetByPath(db, { paths: ["src/auth.ts"], query: "jwt" })
  console.log("   Records:", byPath.length, byPath[0]?.title)

  console.log("\n3. handleRetrieveConstraints (MCP tool)")
  const mcpRetrieved = handleRetrieveConstraints(db, {
    paths: ["src/db/retrieval.ts"],
    query: "BM25 ranking",
    topK: 5,
  })
  console.log("   Records:", mcpRetrieved.length, "scores:", mcpRetrieved.map((r) => r.score.toFixed(2)).join(", "))

  console.log("\n4. handleCheckChange (path + BM25 on changeDescription)")
  const check = handleCheckChange(db, {
    changeDescription: "refactor auth to use jwt.verify",
    affectedPaths: ["src/auth.ts"],
    topK: 10,
  })
  console.log("   riskLevel:", check.riskLevel)
  console.log("   mustConstraints:", check.mustConstraints.length)
  console.log("   relevantDecisions (top-K):", check.relevantDecisions.length)
  console.log("   proceed:", check.proceed)

  console.log("\n5. SessionStart (BM25 by taskDescription)")
  const session = handleSessionStart(db, {
    taskDescription: "refactor JWT auth middleware",
    topK: 5,
  })
  console.log("   activeConstraints:", session?.activeConstraints?.length ?? 0, "| doNotChange:", session?.doNotChange?.length ?? 0)

  console.log("\n6. Slim mode (token reduction)")
  const byPathFull = handleGetByPath(db, { paths: ["src/auth.ts"] })
  const byPathSlim = handleGetByPath(db, { paths: ["src/auth.ts"], slim: true })
  const fullTokens = JSON.stringify(byPathFull).length
  const slimTokens = JSON.stringify(byPathSlim).length
  console.log("   getByPath full:", fullTokens, "chars | slim:", slimTokens, "chars | saved:", Math.round((1 - slimTokens / fullTokens) * 100) + "%")

  const checkSlim = handleCheckChange(db, {
    changeDescription: "refactor auth",
    affectedPaths: ["src/auth.ts"],
    slim: true,
  })
  const checkFullTokens = JSON.stringify(check.relevantDecisions).length
  const checkSlimTokens = JSON.stringify(checkSlim.relevantDecisions).length
  console.log("   checkChange relevantDecisions full:", checkFullTokens, "| slim:", checkSlimTokens, "| saved:", Math.round((1 - checkSlimTokens / checkFullTokens) * 100) + "%")

  console.log("\n✓ All retrieval flows work (no API key required)")
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => {
    rmSync(workDir, { recursive: true, force: true })
  })
