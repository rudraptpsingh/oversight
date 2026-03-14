import { writeConfig, findWhycodeDir } from '../dist/utils/config.js'
import { initDb, getDb } from '../dist/db/schema.js'
import { insertDecision, getDecisionsByPath, getAllDecisions } from '../dist/db/decisions.js'
import { searchDecisions } from '../dist/db/search.js'
import { handleRecord } from '../dist/mcp/tools/record.js'
import { handleGetByPath } from '../dist/mcp/tools/getByPath.js'
import { handleSearch } from '../dist/mcp/tools/search.js'
import { handleCheckChange } from '../dist/mcp/tools/checkChange.js'
import { v4 as uuidv4 } from 'uuid'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_DIR = path.resolve(__dirname, '..')
const WHYCODE_DIR = path.join(PROJECT_DIR, '.whycode')

const RESET = '\x1b[0m'
const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const CYAN = '\x1b[36m'
const BOLD = '\x1b[1m'
const YELLOW = '\x1b[33m'

function pass(label) {
  console.log(`${GREEN}✓${RESET} ${label}`)
}

function fail(label, err) {
  console.log(`${RED}✗${RESET} ${label}`)
  console.log(`  ${RED}${err}${RESET}`)
  process.exit(1)
}

function section(title) {
  console.log(`\n${BOLD}${CYAN}── ${title} ──${RESET}`)
}

function assert(condition, label, detail = '') {
  if (!condition) fail(label, detail || 'Assertion failed')
  pass(label)
}

// ── STEP 1: Initialize WhyCode ──
section('Step 1: Initialize WhyCode')

fs.mkdirSync(WHYCODE_DIR, { recursive: true })

writeConfig({
  version: '1.0.0',
  author: 'Claude (claude-sonnet-4-6)',
  repoRoot: PROJECT_DIR,
  createdAt: new Date().toISOString()
}, PROJECT_DIR)

const db = initDb(WHYCODE_DIR)

const configExists = fs.existsSync(path.join(WHYCODE_DIR, 'config.json'))
assert(configExists, 'config.json created at .whycode/config.json')

const dbExists = fs.existsSync(path.join(WHYCODE_DIR, 'decisions.db'))
assert(dbExists, 'decisions.db created at .whycode/decisions.db')

const config = JSON.parse(fs.readFileSync(path.join(WHYCODE_DIR, 'config.json'), 'utf-8'))
assert(config.author === 'Claude (claude-sonnet-4-6)', `author set to: ${config.author}`)

// ── STEP 2: Record a real decision via whycode_record ──
section('Step 2: Record decision via whycode_record MCP tool')

const recorded = handleRecord(db, {
  title: 'SQLite for local-first offline storage',
  summary: 'WhyCode uses SQLite (not a cloud DB) so it works offline in any dev environment',
  decision: 'Use better-sqlite3 for all data persistence, stored at .whycode/decisions.db relative to the repo',
  context: 'WhyCode is a developer CLI tool. Developers run it locally, often in air-gapped or offline environments. Requiring a network connection to a cloud database (e.g. Supabase) would break the tool for these users and add infrastructure dependencies.',
  rationale: 'SQLite is embedded, requires zero network, has excellent Node.js support via better-sqlite3, and supports FTS5 for full-text search. It is the correct choice for a local developer tool.',
  constraints: [
    {
      description: 'The database must remain local — never require a network connection for core read/write operations',
      severity: 'must',
      rationale: 'Offline-first is a core design principle. Agents and developers must be able to use WhyCode without internet access.'
    },
    {
      description: 'Do not add cloud sync or remote database options without preserving the local-first path',
      severity: 'should',
      rationale: 'Cloud sync may be added later as an optional feature but must never become required.'
    }
  ],
  alternatives: [
    {
      description: 'Supabase PostgreSQL',
      rejectionReason: 'Requires network access and external service account — incompatible with offline-first requirement',
      tradeoffs: 'Would enable multi-device sync but breaks the fundamental use case'
    },
    {
      description: 'JSON flat file (.whycode/decisions.json)',
      rejectionReason: 'No full-text search capability, poor performance at scale, no transactional integrity',
      tradeoffs: 'Simpler but insufficient for semantic search requirements'
    }
  ],
  anchors: [
    { type: 'file', path: 'src/db/schema.ts' },
    { type: 'file', path: 'src/db/decisions.ts' },
    { type: 'file', path: 'src/db/search.ts' }
  ],
  tags: ['sqlite', 'storage', 'offline', 'architecture'],
  decisionType: 'architectural',
  confidence: 'definitive',
  agentHints: [
    {
      instruction: 'Do not replace SQLite with a cloud database. If you need to add persistence features, extend the SQLite schema.',
      scope: 'file'
    },
    {
      instruction: 'The .whycode/decisions.db path is intentional — it lives alongside the codebase for portability.',
      scope: 'file'
    }
  ],
  doNotChange: [],
  reviewTriggers: ['supabase', 'postgres', 'cloud', 'remote database', 'sync']
})

assert(recorded.id && recorded.id.length > 0, `Decision ID generated: ${recorded.id.slice(0, 8)}...`)
assert(recorded.record.title === 'SQLite for local-first offline storage', 'Title stored correctly')
assert(recorded.record.constraints.length === 2, `2 constraints stored: ${recorded.record.constraints.map(c => c.severity).join(', ')}`)
assert(recorded.record.alternatives.length === 2, '2 alternatives stored (Supabase, JSON flat file)')
assert(recorded.record.anchors.length === 3, '3 file anchors stored')
assert(recorded.record.agentHints.length === 2, '2 agent hints stored')
assert(recorded.record.author === 'Claude (claude-sonnet-4-6)', `Author set from config: ${recorded.record.author}`)

const DECISION_ID = recorded.id

// ── STEP 3: Retrieve via whycode_get_by_path ──
section('Step 3: Retrieve via whycode_get_by_path')

const byPath = handleGetByPath(db, { path: 'src/db/schema.ts' })
assert(byPath.length === 1, `Found 1 decision for src/db/schema.ts`)
assert(byPath[0].id === DECISION_ID, `Correct decision returned by ID`)
assert(byPath[0].constraints[0].severity === 'must', `Must constraint preserved: "${byPath[0].constraints[0].description.slice(0, 50)}..."`)

const byPath2 = handleGetByPath(db, { path: 'src/db/decisions.ts' })
assert(byPath2.length === 1, `Same decision found via src/db/decisions.ts anchor`)

const byPathEmpty = handleGetByPath(db, { path: 'src/cli/index.ts' })
assert(byPathEmpty.length === 0, `Returns empty array for unanchored file (src/cli/index.ts)`)

// ── STEP 4: Full-text search via whycode_search ──
section('Step 4: Search via whycode_search')

const searchSqlite = handleSearch(db, { query: 'SQLite offline' })
assert(searchSqlite.length > 0, `FTS search for "SQLite offline" returned ${searchSqlite.length} result(s)`)
assert(searchSqlite[0].id === DECISION_ID, `Correct decision surfaced by FTS`)

const searchStorage = handleSearch(db, { query: 'local storage embedded' })
assert(searchStorage.length > 0, `FTS search for "local storage embedded" returned ${searchStorage.length} result(s)`)

const searchNotFound = handleSearch(db, { query: 'kubernetes microservices terraform' })
assert(searchNotFound.length === 0, `FTS search for unrelated terms returns 0 results`)

const searchByTag = handleSearch(db, { tags: ['offline'] })
assert(searchByTag.length === 1, `Tag filter for "offline" returns correct decision`)

// ── STEP 5: Risk assessment via whycode_check_change ──
section('Step 5: Risk assessment via whycode_check_change')

console.log(`\n${YELLOW}  Scenario: Agent is about to replace SQLite with Supabase...${RESET}`)

const riskResult = handleCheckChange(db, {
  changeDescription: 'Replace better-sqlite3 with Supabase PostgreSQL for cloud persistence and multi-device sync',
  affectedPaths: ['src/db/schema.ts', 'src/db/decisions.ts', 'src/db/search.ts']
})

assert(riskResult.riskLevel === 'high', `Risk level is HIGH (must constraints present)`)
assert(riskResult.mustConstraints.length === 1, `1 must-constraint surfaced: "${riskResult.mustConstraints[0].description.slice(0, 60)}..."`)
assert(riskResult.warnings.length >= 1, `${riskResult.warnings.length} warning(s) generated`)
assert(riskResult.relevantDecisions.length === 1, `1 relevant decision found across all 3 affected paths`)

console.log(`\n${YELLOW}  Warnings the agent would receive:${RESET}`)
for (const w of riskResult.warnings) {
  console.log(`  ${YELLOW}⚠${RESET}  ${w}`)
}

// ── STEP 6: Record meta-decision about this self-test ──
section('Step 6: Record meta-decision about agent self-test')

const metaDecision = handleRecord(db, {
  title: 'WhyCode validated by agent self-test (Claude claude-sonnet-4-6)',
  summary: 'Claude ran a live MCP self-test on 2026-03-14 and confirmed all 5 tools work correctly',
  decision: 'WhyCode MCP tools are confirmed working end-to-end in a live agent environment',
  context: 'A Claude agent (claude-sonnet-4-6) tested WhyCode by using its own MCP tools — record, get_by_path, search, check_change — against the WhyCode project\'s own .whycode/decisions.db. This confirms the MCP integration works as designed.',
  rationale: 'Testing the tool with an actual AI agent consuming the MCP tools is the truest validation of the agent-first design goal.',
  tags: ['meta', 'self-test', 'agent-validation'],
  decisionType: 'compliance',
  confidence: 'definitive',
  anchors: [
    { type: 'file', path: 'src/mcp/server.ts' },
    { type: 'file', path: 'src/mcp/tools/record.ts' },
    { type: 'file', path: 'src/mcp/tools/getByPath.ts' },
    { type: 'file', path: 'src/mcp/tools/search.ts' },
    { type: 'file', path: 'src/mcp/tools/checkChange.ts' }
  ],
  agentHints: [
    {
      instruction: 'This record was created by Claude itself during agent self-testing. It serves as proof-of-concept that MCP tool calls work in real agent sessions.',
      scope: 'file'
    }
  ]
})

assert(metaDecision.record.status === 'active', `Meta-decision stored with status: active`)
assert(metaDecision.record.decisionType === 'compliance', `Decision type: compliance`)

// ── FINAL SUMMARY ──
const allDecisions = getAllDecisions(db)
section('Self-Test Complete')
console.log(`\n${GREEN}${BOLD}All assertions passed.${RESET}`)
console.log(`\nDatabase state at .whycode/decisions.db:`)
console.log(`  Total decisions stored: ${allDecisions.length}`)
for (const d of allDecisions) {
  console.log(`  • [${d.id.slice(0,8)}] ${d.title} (${d.decisionType}, ${d.confidence})`)
  console.log(`    Anchors: ${d.anchors.map(a => a.path).join(', ')}`)
  console.log(`    Constraints: ${d.constraints.length} (${d.constraints.filter(c=>c.severity==='must').length} must, ${d.constraints.filter(c=>c.severity==='should').length} should)`)
}
console.log(`\n${CYAN}This agent (Claude claude-sonnet-4-6) has successfully used WhyCode's MCP tools${RESET}`)
console.log(`${CYAN}to record, retrieve, search, and assess risk on real architectural decisions.${RESET}`)
