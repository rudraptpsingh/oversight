# Oversight

**Oversight for AI agents.** Oversight captures the *why* behind your code so AI assistants never accidentally break decisions you fought hard to get right.

[![npm version](https://img.shields.io/npm/v/oversight.svg)](https://www.npmjs.com/package/oversight)
[![license](https://img.shields.io/npm/l/oversight.svg)](./LICENSE)
[![CI](https://github.com/rudraptpsingh/oversight/actions/workflows/ci.yml/badge.svg)](https://github.com/rudraptpsingh/oversight/actions/workflows/ci.yml)
[![MCP Compatible](https://img.shields.io/badge/MCP-compatible-blue)](https://modelcontextprotocol.io)

---

## The Problem

AI agents are getting better at writing code — but they have no memory. They see a `setTimeout(fn, 2000)` cap and think "I should remove that arbitrary limit." They don't know it was added after a P1 incident that brought down your payment service for 4 hours.

Without context, every agent is flying blind.

## The Solution

Oversight is a local-first decision database that lives alongside your code. It stores architectural constraints, security requirements, and incident learnings in a format AI agents can query before making changes.

**One benchmark tells the story:**

| | Without Oversight | With Oversight |
|---|---|---|
| Constraints respected | 0 / 3 | 3 / 3 |
| Security vulnerability introduced | YES (SSRF) | NO |
| Memory crash risk | YES (OOM) | NO |
| Estimated value | -$100,000 | +$100,000 |

Both agents were equally capable. The only difference was context.

---

## Install

```bash
# As a project dev dependency (recommended)
npm install --save-dev oversight

# Or globally
npm install -g oversight
```

**Auto-setup on install**: When installed as a project dependency in a git repo, Oversight initializes automatically:
- Creates `.oversight/` with config and database
- Adds `.cursor/rules/oversight.mdc` so Cursor agents use Oversight tools
- Adds `.cursor/mcp.json` so the Oversight MCP server is available

If postinstall doesn't run (some npm setups), the first CLI use (`npx oversight list`, etc.) auto-initializes instead.

## Quick Start

```bash
# Initialize (interactive) — or skip; auto-init happens on first use
npx oversight init

# Non-interactive init (uses git author)
npx oversight init --yes

# Record your first decision
npx oversight capture

# View all decisions
npx oversight list

# Open the visual dashboard (http://localhost:7654)
npx oversight dashboard

# Check a file before editing
npx oversight check src/payments/processor.ts

# Search by keyword
npx oversight search "rate limiting"
```

---

## AI Agent Integration (MCP)

Oversight ships a [Model Context Protocol](https://modelcontextprotocol.io) server that gives your AI assistant direct access to your decision database.

### Claude Code

```bash
claude mcp add oversight -- npx -y oversight-mcp
```

### Claude Desktop / Cursor / Windsurf

Add to your MCP configuration:

```json
{
  "mcpServers": {
    "oversight": {
      "command": "npx",
      "args": ["-y", "oversight-mcp"]
    }
  }
}
```

### What the agent can do

| Tool | When an agent uses it |
|---|---|
| `oversight_get_by_path` | Before editing files — pass `paths: ["a.ts","b.ts"]` to batch; surfaces decisions for all paths |
| `oversight_check_change` | Before a refactor — risk assessment + constraint warnings |
| `oversight_search` | When looking for relevant prior decisions |
| `oversight_record` | After making a decision — saves it with full context |
| `oversight_get_by_symbol` | Before modifying a function or class |
| `oversight_capture_conversation` | Extracts decisions from chat history automatically |

---

## Visual Dashboard

Run `npx oversight dashboard` to open a local web interface at **http://localhost:7654** showing:

- All decisions with full context, constraints, and rationale
- Metrics: coverage heatmap, constraint density, agent check history
- Search and filter by type, status, tag, or file path
- Timeline of decisions and recent agent checks
- **Live auto-refresh** — all pages poll every 30 seconds so metrics stay current without a manual reload

---

## CLI Reference

```
oversight init              Initialize Oversight in the current repository
oversight capture           Interactive wizard to record a decision
oversight list              List all decisions (with filtering)
oversight check <path>      Show decisions anchored to a file
oversight search <query>    Full-text search across all decisions
oversight review            Step through decisions that may need updating
oversight heatmap           Show which files have the most coverage
oversight metrics           Print coverage and constraint statistics
oversight hooks install     Add a post-commit git hook reminder
oversight hooks install --enforce   Add pre-commit hook that blocks on constraint violations
oversight enforce on        Enable blocking (pre-commit blocks MUST violations)
oversight enforce off       Disable blocking (advisory mode)
oversight enforce staged    Check staged files (exits 1 if blocked; used by pre-commit)
oversight enforce staged --dry-run   Preview without blocking (CI)
oversight export            Export decisions to JSON (stdout or -o file)
oversight scan              Scan codebase for constraint-like comments (--dry-run, --no-ai)
oversight dashboard         Open visual dashboard at http://localhost:7654
```

---

## What a Decision Record Looks Like

```json
{
  "title": "Redis-Based Distributed Rate Limiting",
  "decisionType": "security",
  "confidence": "definitive",
  "summary": "Rate limiting must use Redis, not in-memory counters",
  "context": "Multi-instance deployment on 3 pods behind a load balancer",
  "decision": "Use Redis INCR with TTL for all rate limit counters",
  "rationale": "In-memory counters are per-instance. A user can bypass rate limits by hitting different pods.",
  "constraints": [
    {
      "severity": "must",
      "description": "Never use Map or in-memory storage for rate limit counters",
      "rationale": "Bypassed by load balancer — PCI compliance violation"
    }
  ],
  "doNotChange": ["rateLimiter\\.redisClient"],
  "agentHints": [
    {
      "trigger": "refactoring rate limiting or caching layer",
      "hint": "Replace in-memory counters with Redis INCR + TTL — never optimize away the Redis call. In-memory counters are per-instance and bypass rate limits across pods."
    }
  ]
}
```

---

## Why Not Just Comments?

| | Code Comments | ADR Markdown Files | Oversight |
|---|---|---|---|
| AI agents can query | No | No | **Yes** |
| Constraint enforcement | No | No | **Yes (risk assessment)** |
| Full-text search | No | Limited | **Yes (FTS5)** |
| Links to specific code | No | Manual | **Yes (code anchors)** |
| Staleness detection | No | No | **Yes** |
| Visual dashboard | No | log4brains | **Yes (built-in)** |
| Works with any language | Yes | Yes | **Yes** |

---

## Benchmarks

### Agent A/B: Auth + Rate Limiting (Scenario B3)

The latest benchmark compares two agents building an Express API with JWT auth and Redis rate limiting:

- **Agent A** — no Oversight, standard tools only
- **Agent B** — Oversight enabled; must call `oversight_get_by_path` before touching auth/rate-limit files

**Result (2 runs, Scenario B3):**

| Metric | Without Oversight | With Oversight |
|--------|-------------------|----------------|
| Mean violations | 9.0 ± 0.0 | 4.0 ± 0.0 |
| Cost at risk | $1.0M | $305k |
| Improvement | — | **56% fewer violations** |

Violations are mapped to real incident costs (auth/rate constraints from `swe-bench-eval`). Full numbers live in the latest report under `benchmarks/agent-ab-test/results/`.

### Token efficiency: BM25 + slim responses

Oversight also benchmarks retrieval overhead. For a project with ~50 decisions anchored to a few paths:

| Approach | Records | Est. tokens |
|----------|---------|-------------|
| Path-only (all matches) | 22 | ~3746 |
| BM25 + path + topK=10 | 10 | ~1667 |
| + slim format (`slim=true`) | 10 | ~380 |

**Takeaway:** Using BM25 + path filter + `slim=true` cuts constraint context by ~90% vs returning every path-matched decision with full fields.

---

## Architecture

```
your-repo/
├── .oversight/
│   ├── config.json       # Author, repo root
│   └── decisions.db      # SQLite database (WAL mode)
└── ...

oversight CLI               # Interactive commands for humans
oversight-mcp server        # Stdio MCP server for AI agents
oversight dashboard         # Local web UI (Vite + React)
```

All data stays local. No account required. No telemetry.

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for how to run tests, submit benchmarks, and add new MCP tools.

```bash
npm install
npm run build
npm test
```

---

## License

MIT — see [LICENSE](./LICENSE)
