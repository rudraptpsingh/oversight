#!/usr/bin/env tsx
/**
 * Seeds the 25 core architectural decisions for the Oversight project itself.
 * Run once after `oversight init` to bootstrap the self-referential feedback loop.
 * Called from postinstall.mjs when seeding a fresh .oversight/ dir.
 */
import { openDatabase } from "../src/db/adapter.js"
import { insertDecision, checkForDuplicates } from "../src/db/decisions.js"
import { getOversightDir } from "../src/utils/config.js"
import path from "path"
import type { OversightRecord } from "../src/types/index.js"
import { v4 as uuidv4 } from "uuid"

function decision(overrides: Partial<OversightRecord> & Pick<OversightRecord, "id" | "title" | "summary" | "decision" | "rationale" | "anchors" | "constraints">): OversightRecord {
  return {
    version: 1,
    status: "active",
    context: overrides.context ?? "",
    alternatives: overrides.alternatives ?? [],
    consequences: overrides.consequences ?? "",
    tags: overrides.tags ?? [],
    decisionType: overrides.decisionType ?? "architectural",
    confidence: overrides.confidence ?? "definitive",
    author: "oversight-seed",
    timestamp: new Date().toISOString(),
    agentHints: overrides.agentHints ?? [],
    doNotChange: overrides.doNotChange ?? [],
    reviewTriggers: overrides.reviewTriggers ?? [],
    supersedes: [],
    ...overrides,
  }
}

const SEED_DECISIONS: OversightRecord[] = [
  decision({
    id: "seed-db-wal-mode",
    title: "SQLite must use WAL mode and better-sqlite3 synchronous driver",
    summary: "Database layer uses WAL journaling mode via better-sqlite3 (synchronous API)",
    decision: "Use better-sqlite3 with WAL mode. All DB operations are synchronous.",
    rationale: "WAL allows concurrent reads during writes. Synchronous API avoids async/await complexity in MCP handlers and eliminates Promise rejection races.",
    anchors: [{ type: "file", path: "src/db/adapter.ts" }, { type: "file", path: "src/db/schema.ts" }],
    constraints: [
      { description: "Database adapter must use better-sqlite3 (synchronous), never node-sqlite3 or async alternatives", severity: "must", rationale: "Async DB in MCP handlers causes unpredictable interleaving and hard-to-test race conditions" },
      { description: "WAL mode must be enabled on every DB open", severity: "must", rationale: "Without WAL, concurrent reads are blocked during any write operation" },
      { description: "Never downgrade to async DB driver without updating all call sites and tests", severity: "must", rationale: "All callers assume synchronous return values" },
    ],
    tags: ["database", "sqlite", "architecture"],
    doNotChange: ["src/db/adapter.ts"],
  }),

  decision({
    id: "seed-mcp-stdio-transport",
    title: "MCP server must use stdio transport only",
    summary: "The MCP server communicates exclusively over stdio, never HTTP/WebSocket",
    decision: "Use StdioServerTransport from @modelcontextprotocol/sdk. No HTTP server in MCP layer.",
    rationale: "stdio is the only transport supported by Claude Desktop, Cursor, and most MCP-capable agents. HTTP transport would require agents to know a port.",
    anchors: [{ type: "file", path: "src/mcp/server.ts" }],
    constraints: [
      { description: "MCP server must use StdioServerTransport, never HTTP or WebSocket", severity: "must", rationale: "Agent host compatibility — stdio is universal" },
      { description: "MCP tool names are public API — never rename or remove a tool without a major version bump", severity: "must", rationale: "Agents hardcode tool names in their prompts and configs" },
      { description: "All MCP tool handlers must be synchronous or return a resolved Promise synchronously", severity: "should", rationale: "Avoids dropped stdio frames during long async operations" },
    ],
    tags: ["mcp", "architecture", "api"],
    doNotChange: ["src/mcp/server.ts"],
    reviewTriggers: ["MCP SDK major version upgrade"],
  }),

  decision({
    id: "seed-bm25-coefficients",
    title: "BM25 retrieval must use k1=1.5, b=0.75 coefficients",
    summary: "Constraint retrieval uses BM25 with specific tuned coefficients",
    decision: "BM25 with k1=1.5, b=0.75. These are the standard Okapi BM25 defaults validated on code search corpora.",
    rationale: "k1=1.5 balances term frequency saturation. b=0.75 applies 75% length normalization — correct for architectural decision text which has variable lengths.",
    anchors: [{ type: "file", path: "src/db/retrieval.ts" }],
    constraints: [
      { description: "BM25 k1 coefficient must remain 1.5 unless re-validated on a constraint recall benchmark", severity: "should", rationale: "Changing k1 without benchmarking will silently degrade retrieval quality" },
      { description: "BM25 b coefficient must remain 0.75 unless re-validated", severity: "should", rationale: "Same reason — b affects length normalization directly" },
      { description: "topK must be capped at 10 in check_change and 20 in session_start", severity: "must", rationale: "Research shows >10 constraints causes 2x-30x token inflation and reasoning degradation" },
    ],
    tags: ["retrieval", "bm25", "performance"],
    doNotChange: ["src/db/retrieval.ts"],
  }),

  decision({
    id: "seed-ai-capture-model",
    title: "AI capture must use claude-sonnet-4-5 or newer, never Haiku",
    summary: "The capture and extraction pipeline uses Sonnet-class models minimum",
    decision: "Use claude-sonnet-4-5 (or newer Sonnet/Opus) for AI-powered capture and scan. Never downgrade to Haiku for quality-critical paths.",
    rationale: "Haiku's instruction following degrades significantly with complex JSON schemas. Sonnet produces reliable structured output for OversightRecord extraction.",
    anchors: [{ type: "file", path: "src/ai/capture.ts" }, { type: "file", path: "src/ai/extractFromCode.ts" }],
    constraints: [
      { description: "AI capture must use claude-sonnet-4-5 or newer — never claude-haiku for record extraction", severity: "must", rationale: "Haiku fails to produce valid OversightRecord JSON ~40% of the time in testing" },
      { description: "Model selection must be overridable via environment variable OVERSIGHT_MODEL", severity: "should", rationale: "Allows CI/testing to use cheaper models without code changes" },
    ],
    tags: ["ai", "claude", "model-selection"],
    reviewTriggers: ["New Claude model release"],
  }),

  decision({
    id: "seed-dashboard-port",
    title: "Dashboard server must use port 7654",
    summary: "The Oversight dashboard binds to port 7654 by default",
    decision: "Dashboard server uses port 7654. This is referenced in documentation, MCP responses, and the cursor rule.",
    rationale: "Fixed port makes it easy to bookmark and reference in docs. 7654 is unlikely to conflict with common dev servers (3000, 8080, etc.).",
    anchors: [{ type: "file", path: "src/dashboard/server.ts" }],
    constraints: [
      { description: "Dashboard default port must remain 7654 unless a conflict is documented", severity: "must", rationale: "Port is referenced in multiple places — changing it silently breaks bookmarks and docs" },
      { description: "Port must be overridable via OVERSIGHT_DASHBOARD_PORT environment variable", severity: "should", rationale: "Allows users with port conflicts to use a different port" },
    ],
    tags: ["dashboard", "configuration"],
    doNotChange: ["src/dashboard/server.ts"],
  }),

  decision({
    id: "seed-oversight-dir-relative",
    title: ".oversight/ directory must be repo-relative, not global",
    summary: "All Oversight state lives in .oversight/ relative to the git root",
    decision: "findOversightDir() walks up from cwd until it finds .oversight/config.json. Never use a global ~/.oversight/ directory.",
    rationale: "Repo-relative storage means decisions travel with the repo (git clone, CI). Global dirs would make decisions machine-specific and un-shareable.",
    anchors: [{ type: "file", path: "src/utils/config.ts" }],
    constraints: [
      { description: "Oversight must never store decisions in a global directory (~/.oversight or XDG_CONFIG)", severity: "must", rationale: "Decisions must be version-controllable and shareable via git" },
      { description: ".oversight/ should be added to .gitignore for decisions.db but not for config.json", severity: "should", rationale: "DB is binary and large; config is small and useful to share" },
    ],
    tags: ["configuration", "filesystem"],
    doNotChange: ["src/utils/config.ts"],
  }),

  decision({
    id: "seed-fts5-sync",
    title: "FTS5 index must be updated synchronously on every write",
    summary: "Full-text search index stays consistent with decisions table via synchronous updates",
    decision: "Any insert/update to decisions table must immediately update the FTS5 index in the same transaction.",
    rationale: "Async index updates would cause search results to lag behind reality. Users searching immediately after a record would get stale results.",
    anchors: [{ type: "file", path: "src/db/decisions.ts" }, { type: "file", path: "src/db/search.ts" }],
    constraints: [
      { description: "FTS5 search index must be updated in the same DB transaction as the decisions table write", severity: "must", rationale: "Stale FTS results cause silent failures where agents cannot find just-recorded decisions" },
    ],
    tags: ["database", "search", "fts5"],
  }),

  decision({
    id: "seed-slim-default",
    title: "slim=true must be the default for check_change and session_start",
    summary: "Token-optimized responses are the default to prevent agent context inflation",
    decision: "check_change and retrieve_constraints default to slim=true. Callers must explicitly pass slim=false for full responses.",
    rationale: "Research shows MCP tool responses that return full decision objects cause 2x-30x token inflation. Slim mode returns ~200 tokens vs ~2000 tokens per session.",
    anchors: [{ type: "file", path: "src/mcp/tools/checkChange.ts" }, { type: "file", path: "src/mcp/tools/sessionStart.ts" }, { type: "file", path: "src/mcp/tools/retrieveConstraints.ts" }],
    constraints: [
      { description: "check_change must default to slim=true — agents must opt-in to full responses", severity: "must", rationale: "Token inflation 2x-30x per MCP call degrades agent reasoning quality" },
      { description: "session_start must never return all constraints — only top-K BM25 ranked by task relevance", severity: "must", rationale: "Injecting all constraints at session start causes reasoning degradation proportional to constraint count" },
      { description: "check_change violations must return plain-language text, never force a JSON schema response", severity: "must", rationale: "JSON schema constraints cause -26% to -63% reasoning degradation on Claude Haiku and similar models" },
    ],
    tags: ["performance", "tokens", "mcp"],
    reviewTriggers: ["MCP context window size increases", "New research on token inflation"],
  }),

  decision({
    id: "seed-constraint-confidence-floor",
    title: "Constraint confidence must never reach zero — floor at 0.05",
    summary: "Confidence floored at 0.05 ensures no constraint becomes permanently ignored",
    decision: "onOverride() uses: conf = max(0.05, conf - 0.15). This prevents confidence from dropping to 0.",
    rationale: "A confidence of 0 would mean the constraint is never enforced again. The floor at 0.05 ensures it stays in the system and can recover with subsequent respected checks.",
    anchors: [{ type: "file", path: "src/engine/confidence.ts" }],
    constraints: [
      { description: "Constraint confidence must never be set below 0.05 by any operation", severity: "must", rationale: "Zero confidence = invisible constraint = silent failure mode" },
      { description: "Auto-downgrade (MUST→SHOULD) must trigger before confidence reaches 0.05", severity: "should", rationale: "Better to downgrade severity than to lose the constraint entirely" },
    ],
    invariant: true,
    tags: ["confidence", "engine"],
    doNotChange: ["src/engine/confidence.ts"],
  }),

  decision({
    id: "seed-check-change-perf",
    title: "check_change must complete in <10ms (synchronous, O(n) over matched constraints only)",
    summary: "Performance constraint: check_change is synchronous and sub-10ms",
    decision: "check_change uses path-filtered BM25 retrieval, not a full table scan. Confidence updates are best-effort and never block the response.",
    rationale: "Agents call check_change at every action boundary. A slow check_change would degrade agent throughput. Research target: <3ms per check (AgentSpec).",
    anchors: [{ type: "file", path: "src/mcp/tools/checkChange.ts" }, { type: "file", path: "src/db/retrieval.ts" }],
    constraints: [
      { description: "check_change must not perform full table scans — always use path-filtered retrieval first", severity: "must", rationale: "O(all constraints) instead of O(path-matched) would add latency proportional to DB size" },
      { description: "Confidence updates in check_change must be best-effort (try/catch) and never block the response", severity: "must", rationale: "A confidence update failure must not break the check result" },
      { description: "check_change should complete in <10ms on a DB with 1000 decisions", severity: "should", rationale: "Agent throughput degrades if MCP tools are slow" },
    ],
    tags: ["performance", "mcp", "check_change"],
  }),

  decision({
    id: "seed-override-rationale-min",
    title: "oversight_override requires minimum 10-character rationale",
    summary: "Override tool enforces meaningful rationale to prevent trivial constraint bypasses",
    decision: "handleOverride() rejects rationale shorter than 10 characters with an error message.",
    rationale: "Empty or trivial rationales (e.g. 'ok', 'fine') provide no audit value. 10 chars is a low bar that filters out reflexive bypasses while not being burdensome.",
    anchors: [{ type: "file", path: "src/mcp/tools/override.ts" }],
    constraints: [
      { description: "oversight_override must reject rationale shorter than 10 characters", severity: "must", rationale: "Short rationales provide no audit value and indicate the agent is bypassing without consideration" },
      { description: "Every override must be logged to override_events table with intent_class", severity: "must", rationale: "Override audit trail is required for outcome-driven violation analysis (ODCV-Bench finding)" },
    ],
    tags: ["override", "audit", "mcp"],
    invariant: true,
  }),

  decision({
    id: "seed-session-report-fields",
    title: "session-report.json must contain all 7 required fields",
    summary: "Self-check output format is stable and required for dashboard consumption",
    decision: "scripts/self-check.ts always writes summary, confidence_deltas, coverage_gaps, stale_decisions, regression_links, override_events, and backlog.",
    rationale: "Dashboard pages and CI integrations depend on these fields. Missing fields would cause silent failures in consumers.",
    anchors: [{ type: "file", path: "scripts/self-check.ts" }],
    constraints: [
      { description: "session-report.json must always contain: summary, confidence_deltas, coverage_gaps, stale_decisions, regression_links, override_events, backlog", severity: "must", rationale: "Dashboard and CI integrations parse these fields directly" },
      { description: "self-check.ts must exit with code 0 even on error — never block commits", severity: "must", rationale: "A failing self-check must not prevent commits" },
      { description: "session-report.json must include drift_bound and outcome_driven_violations in summary", severity: "should", rationale: "These are the key research-backed health metrics" },
    ],
    tags: ["self-check", "reporting"],
    doNotChange: ["scripts/self-check.ts"],
  }),

  decision({
    id: "seed-dedup-constraints",
    title: "Constraints must be deduplicated before insert/update",
    summary: "deduplicateConstraints() is called on every write to prevent exact and subsumption duplicates",
    decision: "insertDecision() and updateDecision() always call deduplicateConstraints() before writing. mergeDecisions() also deduplicates.",
    rationale: "Duplicate constraints inflate check results and create noise in confidence tracking. Subsumption dedup ensures the more comprehensive constraint wins.",
    anchors: [{ type: "file", path: "src/db/decisions.ts" }],
    constraints: [
      { description: "deduplicateConstraints must be called before every DB write of constraints", severity: "must", rationale: "Duplicate constraints cause misleading confidence scores and inflated warning counts" },
      { description: "Dedup must handle both exact matches and subsumption (one description contains the other)", severity: "must", rationale: "Subsumption is common when the same constraint is captured from multiple contexts" },
    ],
    tags: ["database", "constraints", "dedup"],
  }),

  decision({
    id: "seed-backlog-priority-order",
    title: "Backlog items must be sorted CRITICAL > HIGH > MEDIUM > LOW",
    summary: "Backlog generator produces priority-sorted items with CRITICAL first",
    decision: "generateBacklog() sorts output by priority order: CRITICAL=0, HIGH=1, MEDIUM=2, LOW=3.",
    rationale: "Dashboard and agents consuming the backlog should process critical items first. Sort order is the contract.",
    anchors: [{ type: "file", path: "src/self/backlog-generator.ts" }],
    constraints: [
      { description: "Backlog items must always be sorted CRITICAL first, then HIGH, MEDIUM, LOW", severity: "must", rationale: "Consumers rely on sort order — first item should always be highest priority" },
      { description: "RESOLVE_REGRESSION items must always be CRITICAL priority", severity: "must", rationale: "Unresolved regressions are the most dangerous signal — they mean past constraints were violated in production" },
    ],
    tags: ["backlog", "self-check"],
  }),

  decision({
    id: "seed-constraints-table-sync",
    title: "constraints materialized table must stay in sync with decisions.constraints_json",
    summary: "syncConstraintsTable() is called on every insert/update — constraints table is the source of truth for confidence tracking",
    decision: "syncConstraintsTable() is always called from insertDecision() and updateDecision(). It preserves existing confidence/check stats on update.",
    rationale: "If the constraints table drifts from constraints_json, confidence scores become meaningless (tracking a stale constraint) or missing (new constraint not tracked).",
    anchors: [{ type: "file", path: "src/db/decisions.ts" }],
    constraints: [
      { description: "syncConstraintsTable must be called after every insertDecision and updateDecision", severity: "must", rationale: "The constraints table is the source of truth for all confidence/override tracking" },
      { description: "syncConstraintsTable must preserve confidence/check_count/override_count on update (additive only)", severity: "must", rationale: "Resetting confidence stats on every update would wipe all historical data" },
    ],
    tags: ["database", "constraints", "sync"],
    doNotChange: ["src/db/decisions.ts"],
  }),

  decision({
    id: "seed-mcp-tool-count",
    title: "MCP tool count should stay below 20 to prevent context inflation",
    summary: "Number of registered MCP tools is bounded to prevent agent context window inflation",
    decision: "Keep total MCP tool count ≤20. Research shows >20 tools causes significant context inflation without proportional usefulness.",
    rationale: "arxiv 2511.07426: too many MCP tools causes 2x-30x token inflation. Each additional tool description adds ~200 tokens to every agent context.",
    anchors: [{ type: "file", path: "src/mcp/server.ts" }],
    constraints: [
      { description: "Total MCP tool count must not exceed 20 without explicit performance validation", severity: "should", rationale: "Each tool description adds ~200 tokens to agent context; 20 tools = ~4000 tokens overhead" },
      { description: "New tools should consolidate rather than add when at the limit", severity: "should", rationale: "Tool consolidation (e.g. get_by_path + get_by_symbol → get_decision) reduces overhead" },
    ],
    tags: ["mcp", "performance", "architecture"],
    reviewTriggers: ["Adding a new MCP tool"],
  }),

  decision({
    id: "seed-typescript-esm",
    title: "All source files must use ESM imports with .js extensions",
    summary: "Project uses TypeScript ESM modules — all imports must use .js extensions",
    decision: "tsconfig.json uses module: NodeNext/ESM. All import paths must end in .js (TypeScript resolves these to .ts at compile time).",
    rationale: "Node.js ESM requires explicit extensions. Missing .js causes runtime import failures. This is a common source of confusing errors.",
    anchors: [{ type: "file", path: "src/" }, { type: "file", path: "tsconfig.json" }],
    constraints: [
      { description: "All TypeScript import paths must end in .js (not .ts)", severity: "must", rationale: "Node.js ESM resolution requires explicit .js extensions; .ts causes runtime failures" },
      { description: "Never use require() in TypeScript source files", severity: "must", rationale: "Project is pure ESM — CommonJS require() is incompatible" },
    ],
    tags: ["typescript", "esm", "build"],
  }),

  decision({
    id: "seed-post-commit-nonblocking",
    title: "Post-commit hooks must never block commits (exit 0 on all errors)",
    summary: "All Oversight post-commit operations are best-effort and non-blocking",
    decision: "self-check.ts catches all errors and exits with code 0. The post-commit hook uses `|| true` to absorb failures.",
    rationale: "A failing Oversight hook that blocks a commit would make Oversight an obstacle rather than a tool. The value of oversight is advisory, not gatekeeping on commit.",
    anchors: [{ type: "file", path: "src/git/hooks.ts" }, { type: "file", path: "scripts/self-check.ts" }],
    constraints: [
      { description: "Post-commit hooks must exit 0 regardless of errors", severity: "must", rationale: "Blocking commits is a failure mode that breaks developer trust immediately" },
      { description: "self-check.ts must catch all errors and exit 0", severity: "must", rationale: "An uncaught exception in self-check would produce a confusing non-zero exit" },
    ],
    tags: ["git", "hooks", "reliability"],
    invariant: true,
  }),

  decision({
    id: "seed-cli-oversight-prefix",
    title: "All MCP tool names must use the oversight_ prefix",
    summary: "MCP tool names follow the pattern oversight_<verb>_<noun>",
    decision: "All tools registered in server.ts are prefixed with oversight_. Example: oversight_check_change, not check_change.",
    rationale: "Prefix namespacing prevents collision with other MCP servers in multi-server setups. Agents can filter tools by prefix.",
    anchors: [{ type: "file", path: "src/mcp/server.ts" }],
    constraints: [
      { description: "All MCP tool names must start with oversight_", severity: "must", rationale: "Without prefix, tools collide with other MCP servers in multi-server agent setups" },
    ],
    tags: ["mcp", "naming", "api"],
    invariant: true,
  }),

  decision({
    id: "seed-db-schema-additive",
    title: "DB schema migrations must be additive only — never drop columns or tables",
    summary: "Schema changes must preserve backwards compatibility with existing databases",
    decision: "Use CREATE TABLE IF NOT EXISTS and ALTER TABLE ADD COLUMN for all schema changes. Never DROP COLUMN or DROP TABLE.",
    rationale: "Users upgrade Oversight without migrating their decisions.db. A non-additive migration would destroy their data.",
    anchors: [{ type: "file", path: "src/db/schema.ts" }],
    constraints: [
      { description: "Schema changes must only add tables/columns — never drop or rename existing ones", severity: "must", rationale: "Destructive migrations would silently erase user decisions on upgrade" },
      { description: "New columns must have DEFAULT values so existing rows remain valid", severity: "must", rationale: "ALTER TABLE ADD COLUMN without DEFAULT fails on non-empty tables in SQLite" },
    ],
    tags: ["database", "schema", "migration"],
    doNotChange: ["src/db/schema.ts"],
    reviewTriggers: ["Any schema change"],
  }),

  decision({
    id: "seed-session-report-nonblocking",
    title: "session-report.json generation must be non-blocking and gracefully degrade",
    summary: "Self-check failures must not surface to users as errors",
    decision: "All self-check operations use try/catch with best-effort semantics. Missing .oversight/ or empty DB produces a silent skip.",
    rationale: "Users who haven't initialized Oversight, or who run in CI without a DB, should not see script errors.",
    anchors: [{ type: "file", path: "scripts/self-check.ts" }],
    constraints: [
      { description: "self-check.ts must exit 0 when .oversight/ does not exist", severity: "must", rationale: "Non-initialized repos should silently skip self-check" },
      { description: "All DB queries in self-check.ts must be wrapped in try/catch", severity: "must", rationale: "A query error must not crash the entire self-check run" },
    ],
    tags: ["self-check", "reliability"],
  }),

  decision({
    id: "seed-vitest-async-initdb",
    title: "Tests must await initDb() — it is an async function",
    summary: "initDb returns a Promise; all test callers must use await",
    decision: "All test files calling initDb() must use async test functions and await the result.",
    rationale: "initDb is async because openDatabase (better-sqlite3-with-migrations) performs async migration checks. Calling it without await returns a Promise not a Database, causing db.prepare to fail.",
    anchors: [{ type: "file", path: "tests/" }],
    constraints: [
      { description: "All test it() callbacks that call initDb must be async functions using await initDb()", severity: "must", rationale: "Sync initDb() calls return a Promise object — db.prepare() on a Promise throws TypeError" },
    ],
    tags: ["testing", "async", "database"],
  }),

  decision({
    id: "seed-confidence-history",
    title: "Every confidence change must be recorded in constraint_confidence_history",
    summary: "Confidence history enables sparklines, audit, and drift analysis",
    decision: "onRespectedCheck(), onOverride(), runAutoPromote(), runAutoDowngrade() all insert into constraint_confidence_history.",
    rationale: "Without history, the confidence dashboard page cannot show trends. The drift bound D* calculation requires historical data.",
    anchors: [{ type: "file", path: "src/engine/confidence.ts" }],
    constraints: [
      { description: "Every confidence mutation must insert a row into constraint_confidence_history with event_type", severity: "must", rationale: "History is required for sparklines, D* computation, and audit trail" },
      { description: "event_type must be one of: check, override, promote, downgrade", severity: "must", rationale: "Consistent event_type values are required for history analysis queries" },
    ],
    tags: ["confidence", "history", "engine"],
  }),

  decision({
    id: "seed-override-intent-classification",
    title: "Override intent must be classified as task_pressure, disagreement, or legitimate_exception",
    summary: "classifyOverrideIntent() categorizes why an agent bypassed a constraint",
    decision: "Every override is classified via heuristic keyword matching into one of 3 intent classes.",
    rationale: "ODCV-Bench shows 30-71% of SOTA model violations are outcome-driven (task_pressure). Classifying intent enables detection of this specific failure mode.",
    anchors: [{ type: "file", path: "src/engine/confidence.ts" }, { type: "file", path: "src/mcp/tools/override.ts" }],
    constraints: [
      { description: "Override intent classification must cover: task_pressure, disagreement, legitimate_exception, unknown", severity: "must", rationale: "Downstream analytics in session-report depend on these exact class names" },
      { description: "task_pressure classification must trigger a backlog STRENGTHEN item when rate > 30%", severity: "should", rationale: "High task_pressure override rate indicates the constraint needs strengthening, not just acknowledgment" },
    ],
    tags: ["override", "classification", "odcv"],
  }),

  decision({
    id: "seed-pi-bench-consistency",
    title: "Consistency score tracks pass^8 rate — the Π-Bench metric",
    summary: "updateConsistencyScore() maintains a rolling 8-check consistency window",
    decision: "consistency_score = (passed checks in last 8) / 8. Updated on every check_change call.",
    rationale: "Π-Bench shows SOTA models have pass^8 < 25% without enforcement. Single-check confidence is misleading. The 8-check window is the research-validated reliability measure.",
    anchors: [{ type: "file", path: "src/engine/confidence.ts" }],
    constraints: [
      { description: "Consistency window must be exactly 8 checks (the Π-Bench window)", severity: "should", rationale: "8 is the research-validated window size for meaningful consistency measurement" },
      { description: "Constraints with consistency_score < 0.5 must appear in unreliable_constraints in session-report", severity: "must", rationale: "Agents must be warned about unreliable constraints before relying on them" },
    ],
    tags: ["consistency", "pi-bench", "confidence"],
  }),
]

async function main(): Promise<void> {
  const oversightDir = getOversightDir()
  const dbPath = path.join(oversightDir, "decisions.db")
  const db = await openDatabase(dbPath)

  let inserted = 0
  let skipped = 0

  for (const record of SEED_DECISIONS) {
    try {
      const check = checkForDuplicates(db, {
        title: record.title,
        summary: record.summary,
        decision: record.decision,
      })

      if (check.recommendation === "skip") {
        skipped++
        continue
      }

      insertDecision(db, record)
      inserted++
    } catch (err) {
      process.stderr.write(`Warning: failed to seed "${record.title}": ${String(err)}\n`)
    }
  }

  process.stdout.write(`Seeded ${inserted} decisions (${skipped} already existed).\n`)
}

main().catch((err) => {
  process.stderr.write(`Seed failed: ${String(err)}\n`)
  process.exit(1)
})
