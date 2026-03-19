# Oversight MVP Plan: Research-Backed Quick-Ship

## Research Papers Reviewed (2024–2026)

| Paper | Key Insight Affecting Oversight |
|---|---|
| AGENTIF (arxiv 2505.16944, NeurIPS 2025) | SOTA models follow only 30% of instructions perfectly with ~12 constraints; runtime enforcement is critical |
| ODCV-Bench (arxiv 2512.20798) | 30–71% of SOTA models violate constraints under KPI/goal pressure — deliberate misalignment, not accidental |
| Agent Behavioral Contracts (arxiv 2602.22302) | Formal (P,I,G,R) contract model gives measurable drift bounds: D* = α/γ |
| AgentSpec (arxiv 2503.18666) | DSL-based runtime enforcement: 90–100% effectiveness; triggers+predicates+enforcement actions |
| GaaS (arxiv 2508.18765) | Graduated interventions: Coercive (block) → Normative (redirect) → Adaptive (trust score modulation) |
| Pro2Guard (arxiv 2508.00500) | Proactive DTMC-based prediction: intervene BEFORE violations using learned execution traces |
| τ-Bench (arxiv 2406.12045) | Consistency is the real problem: pass^8 rate < 25% — single checks are meaningless |
| Specification Gaming in Reasoning Models (arxiv 2502.13295) | o1/o3 hack reward systems by default; advanced reasoning WORSENS constraint violation risk |
| TRiSM (arxiv 2506.04133) | Memory poisoning + multi-agent coordination failures are emerging attack vectors |
| Safety Tax (arxiv 2503.00555) | Prompt-based alignment = 7–32% reasoning degradation; runtime enforcement = zero alignment tax |

**Core insight from research**: Prompt-based constraints reliably fail around 400 lines of context. Structural, code-based enforcement at the MCP boundary (what Oversight does) is the correct architectural approach — validated by all 10 papers. The gaps are in **graduated response**, **consistency tracking**, and **formal contract coverage**.

## Context

Oversight is an open-source AI agent decision intelligence platform (v0.1.1). It prevents coding agents from repeating architectural mistakes by storing constraints as enforceable rules. The current open core (SQLite, MCP server, 14 tools, CLI, React dashboard) is production-shipped to npm but has a critical zero-value problem: `decisions.db` ships empty. The MVP plan targets two milestones: MVP-1 (500 GitHub stars, HN front page) by Week 3, and MVP-2 (first paying team) by Week 8.

**Current gap from plan**: DB has 3 tables (decisions, check_change_log, sessions) — constraints are stored as JSON arrays inside decisions, NOT as a normalized table. This is the architectural blocker for the confidence engine.

---

## Critical Architectural Decision First

**Constraints table normalization** (before any other work):

The MVP plan says `ALTER TABLE constraints ADD COLUMN confidence...` but no `constraints` table exists. Constraints live in `decisions.constraints_json`.

**Approach**: Create a materialized `constraints` table synced from JSON on every write. Additive migration, no existing data broken.

```sql
CREATE TABLE IF NOT EXISTS constraints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  decision_id TEXT NOT NULL REFERENCES decisions(id),
  description TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'should', -- must|should|avoid
  rationale TEXT NOT NULL DEFAULT '',
  confidence REAL NOT NULL DEFAULT 0.5,
  check_count INTEGER NOT NULL DEFAULT 0,
  override_count INTEGER NOT NULL DEFAULT 0,
  last_checked INTEGER  -- Unix ms
);

CREATE TABLE IF NOT EXISTS constraint_confidence_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  constraint_id INTEGER NOT NULL,
  confidence REAL NOT NULL,
  recorded_at INTEGER NOT NULL,
  event_type TEXT NOT NULL  -- check|override|promote|downgrade
);

CREATE TABLE IF NOT EXISTS override_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  constraint_id INTEGER REFERENCES constraints(id),
  decision_id TEXT REFERENCES decisions(id),
  commit_sha TEXT,
  rationale TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS regression_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  decision_id TEXT REFERENCES decisions(id),
  commit_sha TEXT NOT NULL,
  test_name TEXT NOT NULL,
  failure_message TEXT,
  created_at INTEGER NOT NULL
);
```

Files to modify:
- `src/db/schema.ts` — add 4 tables above
- `src/db/decisions.ts` — sync to `constraints` table on every insert/update

---

## Performance Research: Will Oversight Regress Agent Performance?

**Short answer: No, if implemented correctly. Yes, if implemented wrong.**

### What the research shows:

| Technique | Effect on Performance | Source |
|---|---|---|
| Semantic/architecture-aware constraints | **+28%** code quality (DeepSeek-6.7B) | Type-Constrained Code Generation, 2025 |
| Grammar constraints on reasoning (CRANE) | **+9%** accuracy on small models | arxiv 2502.09061 |
| Runtime enforcement overhead (AgentSpec) | **<3ms per check**, <5% of inference | arxiv 2503.18666 |
| Format/JSON schema restrictions on reasoning | **-26% to -63%** accuracy | "Let Me Speak Freely", arxiv 2408.02442 |
| Too many MCP tools in context | **2x–30x** token inflation | arxiv 2511.07426 |
| Constraint forcing strict output schema | **-63%** on Claude Haiku math reasoning | arxiv 2408.02442 |

**Verdict**: Oversight's approach (semantic architectural constraints at MCP boundary, never constraining agent output format) is the correct direction. The anti-patterns are: forcing format restrictions, inflating prompts with too many constraints, and over-calling MCP tools.

### Phase 1 Performance Safeguards (MUST implement):

**1. `slim=true` as default in `session_start` and `retrieve_constraints`**
- Already implemented, but must be the DEFAULT (not opt-in)
- Token inflation is the #1 MCP performance killer (2x–30x inflation)
- Constraint retrieval with BM25 + slim = ~200 tokens vs ~2000 tokens per session

**2. Cap BM25 retrieval at 10 constraints max (already at topK=10)**
- Confirmed: correct approach. More constraints = token inflation = reasoning degradation
- Fewer, more relevant constraints > many constraints

**3. Never force format restrictions in check_change response**
- check_change must return human-readable text, not force agent to respond in JSON schema
- JSON schema response constraints would cause -26% to -63% reasoning degradation
- The `redirect_hint` and violation messages must be plain language

**4. No synchronous MCP calls during agent reasoning**
- check_change is a pre-commit/pre-action check, not a mid-reasoning interrupt
- If check_change is called mid-reasoning, agent reasoning quality degrades
- Keep it at action boundaries only

**5. Constraint retrieval is lazy (on-demand), never eager**
- Don't inject all constraints at session start
- Retrieve only when files are being edited (already how retrieve_constraints works)
- BM25 path filtering ensures relevance

---

## Research-Driven Architecture Changes

These improvements are not in the MVP plan doc but are directly validated by the papers above. They're additive and low-effort to implement.

### A. Graduated Interventions (GaaS model — 1 day)
*Performance note: Redirect hints are plain language only, never JSON schema — avoids -26% to -63% reasoning degradation.*
Current Oversight: binary block/allow on MUST violations.
Research says: Coercive (block) → Normative (redirect with alternative) → Adaptive (trust modulation).

**Change to `check_change` output**:
```typescript
interface CheckResult {
  enforcement: 'blocked' | 'warning' | 'redirected' | 'allowed'
  redirect_hint?: string  // "Consider approach X instead" — Normative enforcement
  trust_delta?: number    // Session-level trust adjustment
}
```

Add `redirect_hint` to Constraint type: when a MUST constraint fires, surface the `rationale` + `alternatives` as a redirect, not just a block message.

### B. Consistency Tracking (τ-Bench finding — 1 day)
*Performance note: consistency_score is computed offline in self-check.ts, never during agent runtime — zero overhead.*
Current: single confidence score. Research shows pass^N < 25% for SOTA models.

**Add to constraints table**: `consistency_score REAL` = rolling pass^8 rate (last 8 checks).
This is more meaningful than single confidence for predicting if an agent will actually respect a constraint.

In session-report.json: surface constraints with `consistency_score < 0.5` as "Unreliable Constraints" section — these need strengthening.

### C. Formal Contract Coverage (Agent Behavioral Contracts — 2 days)
Current: constraints have description + severity. Research proves (P,I,G,R) structure gives measurable compliance guarantees and drift bounds.

**Extend Constraint type**:
```typescript
interface Constraint {
  description: string
  severity: 'must' | 'should' | 'avoid'
  rationale: string
  // NEW: research-backed fields
  precondition?: string    // P: when does this constraint apply?
  invariant?: boolean      // I: true = must hold for entire session, not just on check
  recovery?: string        // R: what to do if violated (not just block)
}
```

**Drift bound tracking** in self-check.ts:
```
α = override_count / check_count  (drift rate)
γ = auto-strengthen events / override_events  (recovery rate)
D* = α / γ  (equilibrium drift — lower is better)
```
Surface D* in session-report.json as `summary.drift_bound`. Dashboard shows this as health indicator.

### D. Outcome-Driven Violation Detection (ODCV-Bench finding — 1 day)
ODCV shows agents deliberately violate constraints under KPI pressure, not by accident.

**In `oversight_override` tool**: classify rationale as:
- `'legitimate_exception'` — constraint genuinely doesn't apply to this context
- `'task_pressure'` — agent is bypassing to complete task faster
- `'disagreement'` — agent thinks constraint is wrong

Classify using simple heuristics (task_pressure: rationale mentions "deadline", "faster", "simpler", "need to"; disagreement: mentions "incorrect", "outdated", "wrong").

Surface `outcome_driven_violations` in session-report.json with count + affected constraints. This is the most dangerous failure mode per research.

### E. Pre-Commit Proactive Warning (Pro2Guard inspiration — 1 day)
Pro2Guard uses DTMC to predict violations before they happen. Simplified version:

In `check_change.ts`: before returning results, cross-reference changed file paths against `check_change_log` history. If a file has ≥3 previous check violations in last 30 commits, add `pre_violation_warning` to response: "This file has a history of constraint violations. Review constraints carefully before proceeding."

This is a cheap version of proactive prediction — no DTMC needed, just historical pattern matching.

---

## Phase 1: Self-Referential Feedback Loop (Weeks 1–2) — CRITICAL

**This is the only blocker for MVP-1. Everything else is incremental.**

### 1.1 Seed 25 Decisions — SHIP FIRST (1 day)

Modify `scripts/postinstall.mjs` to seed decisions on first install.

Decisions to capture (run `oversight capture` on these files):
- `src/db/schema.ts` — WAL mode, FTS5, better-sqlite3 sync driver
- `src/mcp/server.ts` — stdio transport, MCP tool name stability as public API
- `src/db/retrieval.ts` — BM25 k1=1.5 b=0.75 coefficients
- `src/ai/capture.ts` — claude-sonnet-4-5, never downgrade to haiku
- `src/dashboard/server.ts` — port 7654
- `src/utils/config.ts` — .oversight/ is repo-relative
- `src/db/decisions.ts` — FTS5 index updated synchronously
- Plus 18 more from existing architectural choices

### 1.2 Performance-Safe defaults (0.5 days — do first)

Before confidence engine: verify existing defaults don't regress performance.

Check and fix in `src/mcp/tools/sessionStart.ts` and `src/mcp/tools/retrieveConstraints.ts`:
- `slim` must default to `true` (not opt-in). Token inflation at 2x–30x per MCP call is the top killer.
- `topK` hard cap at 10 (already present, verify it's enforced)
- session_start response must NOT inject all constraints — only slim summary + count
- check_change violations must return plain-language text, never force JSON schema response

Verify in `src/mcp/tools/checkChange.ts`:
- Constraint check is O(n) over matching constraints only (BM25-filtered), not O(all constraints)
- Execution should be synchronous and <10ms (verify with a quick timing test)

### 1.3 Confidence Engine (2 days)

New file: `src/engine/confidence.ts`

```typescript
// On respected check (called from checkChange.ts)
function onRespectedCheck(db, constraintId: number)
// conf += 0.02 * (1 - conf); exponential smoothing → asymptotes to 1.0

// On override (called from new override MCP tool)
function onOverride(db, constraintId: number, rationale: string)
// conf = max(0.05, conf - 0.15); floor prevents zeroing

// Auto-promote pass (called from self-check.ts)
function runAutoPromote(db)
// SHOULD → MUST when conf > 0.9 AND check_count > 20

// Auto-downgrade pass (called from self-check.ts)
function runAutoDowngrade(db)
// MUST → SHOULD when conf < 0.25 AND override_count > 3
```

Modify `src/mcp/tools/checkChange.ts`: call `onRespectedCheck()` for each non-violated constraint.

### 1.4 Self-Check Script (2 days)

New file: `scripts/self-check.ts`

Triggered by post-commit hook. Writes `.oversight/session-report.json`.

Computation logic:
| Output Field | Logic |
|---|---|
| `summary.decision_quality_avg` | `(has_constraints×0.3) + (has_hints×0.2) + (has_rationale×0.2) + (definitive×0.2) + (has_alternatives×0.1)` |
| `summary.coverage_score` | `anchored_files ÷ git ls-files count × 100` |
| `summary.avg_confidence` | Average of `constraints.confidence` across all active |
| `confidence_deltas` | Diff current vs previous report's constraint confidences |
| `stale_decisions` | Days since decision updated ÷ days since file last committed > 2 |
| `backlog` | Run all 5 backlog generators (below) |
| `regression_links` | Read CI_TEST_RESULT env var; cross-reference check_change_log |

Modify `src/cli/commands/hooks.ts`: include `npx tsx scripts/self-check.ts` in post-commit hook.

### 1.5 Backlog Generator (1 day)

New file: `src/self/backlog-generator.ts`

| Type | Trigger | Priority |
|---|---|---|
| STRENGTHEN | override_rate > 0.3 on any constraint | HIGH |
| CAPTURE | file with >3 commits/90 days, no anchored decision | HIGH |
| RESOLVE_REGRESSION | unresolved regression_links entry | CRITICAL |
| PROMOTE | SHOULD constraint: conf > 0.9 AND check_count > 20 | MEDIUM |
| REVIEW | Decision not updated in 90d AND file has recent commits | LOW |

### 1.6 New MCP Tools for Phase 1

- `src/mcp/tools/override.ts` — `oversight_override`: requires 10-char rationale; calls `onOverride()`; blocks with error if rationale missing
- `src/mcp/tools/getSessionReport.ts` — `oversight_get_session_report`: returns latest session-report.json; called internally by session_start

Modify `src/mcp/tools/sessionStart.ts`: include session-report summary in response payload.

**Phase 1 Acceptance Criteria:**
1. `git commit` triggers self-check → `.oversight/session-report.json` written
2. JSON has all 7 required fields (summary, confidence_deltas, coverage_gaps, stale_decisions, regression_links, override_events, backlog)
3. Confidence increments after `oversight_check_change` with no violations (query DB before/after)
4. `oversight_override` blocks on empty/short rationale (unit test)
5. `decisions.db` ships with ≥25 active decisions (run `oversight list | wc -l`)
6. Backlog generator produces ≥3 items on cold run

---

## Phase 2: Dashboard Completion (Week 3) — HIGH

Four new pages, all reading from `session-report.json` + REST API.

### New Dashboard Pages

All under `src/ui/pages/`:

**BacklogPage.tsx** (`/backlog`)
- Priority swimlanes: CRITICAL • HIGH • MEDIUM • LOW
- Card: type badge + title + evidence + linked decision + "Mark Resolved" button
- Empty state: "Decision debt: 0. Your codebase is fully documented."
- API: `GET /api/backlog` → reads `.oversight/backlog.json`
- API: `POST /api/backlog/:id/resolve`

**ConfidencePage.tsx** (`/confidence`)
- Headline: avg constraint confidence gauge (0–1)
- Bar chart: all constraints ranked by confidence (green >0.8, amber 0.5–0.8, red <0.5)
- "Ready to Promote" section: SHOULD constraints with conf >0.9, check_count >20, one-click promote
- "At Risk" section: MUST constraints with conf <0.3
- 30-day sparklines from `constraint_confidence_history`

**CoveragePage.tsx** (`/coverage`)
- Large coverage gauge (0–100%) from `session-report.summary.coverage_score`
- File list grouped by directory: green (anchored+fresh), amber (anchored+stale), red (no coverage)
- Gap table from `session-report.coverage_gaps` sorted by change_frequency
- Quick capture: click uncovered file → opens capture wizard pre-filled

**RegressionsPage.tsx** (`/regressions`)
- Table: test name + commit SHA + linked decision + failure date + regression count
- "Strengthen Decision" CTA per row
- API: `GET /api/regressions`

### Files to Modify
- `src/ui/pages/` — add 4 new page files
- `src/ui/App.tsx` — add 4 new routes
- `src/ui/components/Sidebar.tsx` — add 4 navigation items
- `src/ui/api.ts` — add `fetchBacklog()`, `resolveBacklogItem()`, `fetchRegressions()`, `fetchCoverage()`
- `src/dashboard/server.ts` — add `/api/backlog`, `/api/regressions`, `/api/coverage` endpoints

---

## Phase 3: Remaining MCP Tools (Week 4) — MEDIUM

- `src/mcp/tools/promote.ts` — `oversight_promote`: human-triggered SHOULD→MUST before auto-threshold
- `src/mcp/tools/linkRegression.ts` — `oversight_link_regression`: accepts test_name + failure_message + commit_sha + optional decision_id; uses FTS5 to find candidate decisions when decision_id missing

Register all new tools in `src/mcp/server.ts`.

---

## Phase 4: GitHub App + CI JSON (Weeks 5–6) — HIGH

### CI JSON Output (1 day, ship before GitHub App)

Extend `src/cli/commands/enforce.ts` with `--json` flag:
```json
{
  "would_block": true,
  "violations": [{"file": "...", "constraint": "...", "severity": "MUST", "decision_id": "..."}],
  "warnings": [],
  "coverage_score": 79,
  "coverage_delta": -5
}
```

### GitHub App (Probot, 5 days)
New workspace: `oversight-github-app/`
- `src/app.ts` — handles `pull_request.opened`, `pull_request.synchronize`, `push`
- `src/handlers/pull-request.ts` — fetch changed files → download decisions.db → run constraint check → create Check Run → post PR comment
- `src/analyzer/diff-parser.ts` — parse GitHub diff into affected file paths
- `src/analyzer/constraint-checker.ts` — runs check_change logic against downloaded decisions.db
- `src/analyzer/coverage-scorer.ts` — computes coverage_delta between base and PR branches
- Minimum scopes: `contents:read`, `pull_requests:write`, `checks:write`

---

## Phase 5: Cloud Sync (Weeks 7–8) — MEDIUM

Supabase free tier. Local-first architecture.

New files:
- `src/cloud/sync.ts` — push/pull/status logic
- `src/cli/commands/sync.ts` — CLI commands

New CLI commands:
- `oversight sync push` — upload all active decisions
- `oversight sync pull` — download team decisions newer than last pull
- `oversight sync status` — pending changes, conflicts, last sync timestamp
- `oversight team decisions list` — org-wide decisions from all repos

---

## Benchmarking Strategy (Research-Backed, Run Throughout All Phases)

### Benchmark Suite (in `/benchmark/`)

**1. Agent A vs B Constraint Compliance** (existing framework, formalize)
- Agent A: runs without Oversight (no MCP tools)
- Agent B: runs with Oversight MCP tools active
- Measure: violation rate, re-introduction of known bugs, architectural drift
- Use existing `scripts/agent-scenario-test.mjs` as base

**2. Constraint Recall@K Benchmark** (Phase 1 completion)
- Given a code change, does `retrieve_constraints` surface the right constraints?
- Metrics: Recall@5, Recall@10, MRR (Mean Reciprocal Rank)
- Test set: 50 manually labeled (file, constraint) pairs
- Compare: BM25-only vs path-filtered+BM25 vs semantic search

**3. Confidence Calibration Benchmark** (Phase 1 completion)
- Seed a known "fragile" constraint (one that gets overridden)
- Run 20 check_change calls + 3 overrides
- Assert: confidence degraded correctly, auto-downgrade fired, backlog item generated
- Deterministic — same inputs should produce same confidence trajectory

**4. Context-Bench Style Long-Session Test** (Phase 2 completion)
- 25-turn simulated agent session touching the same files repeatedly
- Assert: constraints respected in turn 1 are still enforced in turn 25
- Measures constraint persistence across session boundaries
- Inspired by Letta's Context-Bench (Oct 2025)

**5. Coverage Delta Regression** (Phase 4 completion)
- PR simulation: add a file touching `src/db/schema.ts`
- Assert: GitHub App reports correct coverage_delta and fires constraint check
- Baseline: every CI run stores coverage_score in session-report.json for trend tracking

**6. SWE-bench Constraint Injection** (Launch gate)
- Take 20 SWE-bench tasks involving architectural files
- Inject relevant Oversight constraints before agent run
- Measure: does agent avoid the constraint-violating solution paths?
- Compare: same tasks without Oversight (existing benchmark framework)

**7. Performance Regression Guard (MUST pass before any release)**
- Measure: task completion rate with Oversight active vs inactive on 20 standard coding tasks
- Measure: token usage per task (slim=true should keep this near-neutral)
- Measure: latency per MCP tool call (should be <5ms for check_change)
- Assert: task completion rate with Oversight ≥ task completion rate without
- Assert: token overhead < 15% vs baseline (BM25+slim keeps it low)
- Research baseline: AgentSpec overhead <5% of inference; DOMINO JSON <1s
- **This is a no-ship blocker.** If Oversight causes task regressions, we do not ship.

**8. Smaller Model Parity Benchmark (novel — key marketing claim)**
- Run 20 coding tasks with: (a) GPT-4o alone, (b) Claude Haiku-4.5 + Oversight constraints
- Measure: task success rate, architectural violation rate, code quality score
- Research predicts: semantic constraints (+28% for smaller models) should close the gap
- If Haiku+Oversight approaches GPT-4o quality → headline benchmark for HN post
- Inspired by CRANE (+9% for 7B models) and Type-Constrained Code Generation (+28%)

**9. τ-Bench Consistency Test** (novel — not in existing codebase)
- Run the SAME constraint scenario 8 times in a row
- Report pass^8 rate (how often does agent comply consistently?)
- SOTA models: pass^8 < 25%. Oversight target: pass^8 > 80%
- This is the single most meaningful benchmark for real-world reliability

**8. Outcome-Driven Violation Benchmark (ODCV-inspired)**
- Scenario: Agent has clear task goal (implement feature by deadline) + conflicting constraint (never use X pattern)
- Measure: Does agent comply, override with legitimate rationale, or silently violate?
- Compare: with Oversight vs without (enforcement vs honor-system)
- Expected finding: without Oversight, 30–50% violation under goal pressure (per ODCV-Bench results)

**9. Drift Bound Measurement**
- Run 100 constraint checks + inject 10 deliberate overrides
- Measure: D* = α/γ over time
- Assert: confidence engine recovery rate (γ) exceeds natural drift rate (α) within 50 checks
- This proves the system is self-correcting

**10. Contract Coverage Score**
- After capture, measure % of constraints that have: precondition + invariant flag + recovery hint
- Target: 80% coverage for MUST constraints by MVP-1
- Research (Agent Behavioral Contracts) shows formal coverage correlates with 88–100% hard compliance

### Benchmark Page (oversight.run/benchmark)
- Agent A vs B diff: inline in HN post
- Constraint recall@K table
- Coverage score trend chart
- Live reproduction link

---

## Use Case Coverage

| Use Case | Feature | Phase |
|---|---|---|
| Solo dev starting a new project | Seed decisions on postinstall | Phase 1 |
| Agent avoiding known mistakes | check_change + constraints table | Already live |
| Agent starting a session with context | session_start → session-report summary | Phase 1 |
| Agent bypasses constraint intentionally | oversight_override (with rationale) | Phase 1 |
| Dev sees constraint health at a glance | Confidence dashboard page | Phase 2 |
| Dev sees what decisions need attention | Backlog page with priority swimlanes | Phase 2 |
| CI catches constraint violations in PR | GitHub App + check runs | Phase 4 |
| Team shares decisions across machines | Cloud sync push/pull | Phase 5 |
| Engineering manager sees coverage | Coverage page + coverage badge | Phase 4 |

---

## Use Case Coverage (Research-Validated)

| Use Case | Research Backing | Feature | Phase |
|---|---|---|---|
| Solo dev starting a new project | - | Seed decisions on postinstall | Phase 1 |
| Agent avoiding known mistakes | AGENTIF: 70% fail without enforcement | check_change at MCP boundary | Already live |
| Agent complying consistently | τ-Bench: pass^8 < 25% without enforcement | Consistency score tracking | Research improvement B |
| Agent under goal/deadline pressure | ODCV: 30–71% violate under pressure | outcome_driven violation detection | Research improvement D |
| Reasoning model (o1/o3) bypassing constraints | Spec Gaming paper: o1 hacks by default | Structural MCP enforcement (not prompts) | Already live |
| Agent starting a session with context | - | session_start → session-report summary | Phase 1 |
| Agent bypasses constraint intentionally | - | oversight_override (with rationale classification) | Phase 1 + improvement D |
| Agent gets redirect instead of just block | GaaS: normative enforcement | redirect_hint in check_change response | Research improvement A |
| Dev sees constraint health at a glance | - | Confidence + consistency dashboard page | Phase 2 |
| Dev sees drift bound (system health) | Agent Behavioral Contracts | D* metric in session-report.json | Research improvement C |
| CI catches violations in PR | - | GitHub App + check runs | Phase 4 |
| Long-session constraint persistence | Context-Bench: constraints forgotten in long sessions | invariant flag on constraints | Research improvement C |
| Memory poisoning defense | TRiSM: emerging attack vector | decisions.db integrity + override audit trail | Phase 1 |
| Team shares decisions across machines | - | Cloud sync push/pull | Phase 5 |

---

## SOTA Positioning

**Direct competitors**:
| Tool | What They Do | What Oversight Adds |
|---|---|---|
| SpecLock | Enforcement only, no decision history | + Decision memory + confidence learning + self-improving |
| ContextVault | Memory only, no enforcement | + Active enforcement at MCP boundary |
| Decision Guardian | ADR surfacing in PRs | + AI-native MCP integration + confidence + graduated interventions |
| NeMo Guardrails | General LLM guardrails | + Code-specific ADR enforcement + per-constraint confidence |
| Constitutional AI | Training-time principles | + Runtime enforcement (no alignment tax — 7–32% capability preserved) |

**Oversight's research-validated moat**:
1. **Structural enforcement** (not prompts) — zero alignment tax, works on o1/o3/DeepSeek
2. **Confidence learning** — D* drift bounds prove self-improvement over time
3. **Consistency tracking** — pass^8 metric is the real reliability measure, not single-check
4. **Formal contract coverage** — (P,I,G,R) structure enables 88–100% hard compliance
5. **Self-referential dogfooding** — tool improves itself (unique in the market)

**Key benchmark headline for HN**: AGENTIF shows SOTA models follow only 30% of instructions with ~12 constraints. With Oversight's structural MCP enforcement: target >80% pass^8 consistency rate.

---

## Priority Order for Quick Shipping

```
Week 1:  Constraints table schema migration + seed 25 decisions + confidence engine
Week 2:  Self-check script + backlog generator + oversight_override + oversight_get_session_report
Week 3:  4 dashboard pages — MVP-1 GATE
Week 4:  oversight_promote + oversight_link_regression
Week 5:  CI JSON output (--json flag, 1 day) + GitHub App start
Week 6:  GitHub App complete + coverage badge
Week 7:  Cloud sync infrastructure
Week 8:  Launch: HN + npm v1.0.0 + oversight.run/benchmark live — MVP-2 GATE
```

---

## Critical Files to Modify

| File | Change |
|---|---|
| `src/db/schema.ts` | Add 4 tables (constraints, confidence_history, override_events, regression_links) |
| `src/db/decisions.ts` | Sync constraints table on every insert/update |
| `src/mcp/tools/checkChange.ts` | Call `onRespectedCheck()` after each non-violated constraint |
| `src/mcp/server.ts` | Register new tools: override, promote, get_session_report, link_regression |
| `src/mcp/tools/sessionStart.ts` | Include session-report summary in response |
| `src/cli/commands/hooks.ts` | Add `npx tsx scripts/self-check.ts` to post-commit hook |
| `src/cli/commands/enforce.ts` | Add `--json` flag with structured output |
| `src/ui/App.tsx` | Add 4 new page routes |
| `src/ui/components/Sidebar.tsx` | Add 4 navigation items |
| `src/dashboard/server.ts` | Add /api/backlog, /api/regressions, /api/coverage endpoints |
| `scripts/postinstall.mjs` | Seed 25 decisions on first install in git repos |

## Additional Files for Research-Driven Improvements

| File | Change |
|---|---|
| `src/types/index.ts` | Add `precondition`, `invariant`, `recovery` fields to Constraint type; add `enforcement: 'blocked' \| 'redirected' \| 'warning' \| 'allowed'` to check response |
| `src/mcp/tools/checkChange.ts` | Add `redirect_hint` to violation output; add proactive file-history warning; add graduated intervention logic |
| `src/db/schema.ts` | Add `consistency_score REAL` to constraints table |
| `src/engine/confidence.ts` | Add `updateConsistencyScore()` and `classifyOverrideIntent()` functions |
| `scripts/self-check.ts` | Compute drift bound D* = α/γ; surface `outcome_driven_violations` count; add `unreliable_constraints` section |

---

## New Files to Create

| File | Purpose |
|---|---|
| `src/engine/confidence.ts` | Confidence update logic (increment, decrement, history) |
| `src/self/backlog-generator.ts` | Generates prioritized BacklogItem[] from DB signals |
| `src/self/coverage-analyzer.ts` | Cross-references git ls-files with file_anchors |
| `src/self/staleness.ts` | Detects stale decisions via git log timestamps |
| `scripts/self-check.ts` | Post-commit self-analysis; writes session-report.json |
| `src/mcp/tools/override.ts` | oversight_override tool |
| `src/mcp/tools/promote.ts` | oversight_promote tool |
| `src/mcp/tools/getSessionReport.ts` | oversight_get_session_report tool |
| `src/mcp/tools/linkRegression.ts` | oversight_link_regression tool |
| `src/ui/pages/BacklogPage.tsx` | Backlog swimlane UI |
| `src/ui/pages/ConfidencePage.tsx` | Constraint confidence visualization |
| `src/ui/pages/CoveragePage.tsx` | Coverage heatmap |
| `src/ui/pages/RegressionsPage.tsx` | Regression-to-decision linkage log |
| `oversight-github-app/` | Probot GitHub App (new workspace) |
| `src/cloud/sync.ts` | Cloud sync push/pull/status |
| `src/cli/commands/sync.ts` | CLI sync commands |

---

## Verification Plan

**Performance guard (continuous — run before any ship):**
- `check_change` latency < 10ms (timing test)
- Token overhead with slim=true < 15% vs no-oversight baseline
- Task completion rate with Oversight ≥ without on 20 standard coding tasks
- No format restrictions imposed on agent output (plain language only)

**Phase 1 done when:**
- `git commit` → `.oversight/session-report.json` exists with all 7 fields + `drift_bound` + `outcome_driven_violations`
- `oversight list | wc -l` returns ≥ 25
- Backlog generator returns ≥ 3 items on cold run
- `oversight_override` with short rationale returns error
- DB confidence increments after `check_change` call with no violation

**Phase 2 done when:**
- All 4 dashboard pages load with real data from session-report.json
- Backlog items can be resolved; resolved items move to history tab
- Confidence page shows consistency_score alongside confidence score

**Phase 3 done when:**
- `oversight_session_start` response includes session-report summary in payload
- `oversight_link_regression` without decision_id uses FTS5 to find candidates

**Phase 4 done when:**
- `oversight enforce staged --json` produces structured JSON output
- GitHub App creates Check Run on PR with constraint violations

**Benchmark suite done when:**
- Agent A vs B comparison shows measurable violation rate difference
- τ-Bench consistency test shows pass^8 > 80% with Oversight vs < 25% baseline
- ODCV scenario shows 0 undetected outcome-driven violations
- oversight.run/benchmark live with reproducible numbers
