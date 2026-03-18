# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.1.3] — 2026-03-18

### Fixed
- Fixed 86 failing tests caused by missing `await` on async `initDb()` calls across 7 test files

---

## [0.1.2] — 2026-03-17

### Fixed
- Removed circular self-dependency (`oversight` listed as its own dependency)

### Changed
- Version bump to `0.1.2` for npm publish

---

## [0.1.1] — 2026-03-15

> Patch release — no functional changes from `0.1.0`; corrected package metadata.

---

## [0.1.0] — 2026-03-15

Initial public release. Rebranded from WhyCode to Oversight (npm package `oversight`).

### Added

**CLI (`oversight`)**
- `oversight init` — initialize Oversight in any repository; prompts for author name; auto-detects git user
- `oversight capture` — interactive wizard to record a code decision (title, type, context, decision, rationale, constraints, anchors, tags, confidence)
- `oversight capture --ai` — paste a rough note; an LLM expands it into a full structured record
- `oversight list` — tabular view of all decisions; filterable by `--status`, `--tag`, `--type`; supports `--json`
- `oversight check <path>` — surface all decisions anchored to a file and flag relevant constraints
- `oversight review` — step through decisions that may have gone stale
- `oversight heatmap` — show which files have the most decision coverage
- `oversight hooks install/uninstall` — install git `post-commit` hook that reminds authors to capture decisions
- `oversight metrics` — print coverage stats: decisions per protected file, constraint density, agent hint density

**MCP Server (`oversight-mcp`)**
- `get_by_path` — return all decisions anchored to a file path
- `get_by_symbol` — return decisions by function/class name
- `search` — full-text search over decision titles, summaries, context, and rationale (FTS5 with porter stemming)
- `record` — allow an AI agent to write a new decision directly into the store
- `check_change` — given a change description + affected paths, return relevant constraints, warnings, and a risk level
- `get_metrics` — return project-wide coverage metrics to the agent

**Storage**
- SQLite-backed store (via `better-sqlite3`) in `.oversight/decisions.db`; WAL mode; FTS5 virtual table
- Versioned records with `supersedes` / `supersededBy` links
- `doNotChange` regex patterns and `reviewTriggers` per decision
- `check_change_log` table: every agent check is persisted for auditability

**Programmatic API**
- Full TypeScript types exported from the root package entry point
- `insertDecision`, `getDecisionById`, `getDecisionsByPath`, `getAllDecisions`, `updateDecision`, `deleteDecision`
- `searchDecisions` with query + tag + type + status filters
- `computeMetrics`, `logCheckChange`
- `initDb`, `getDb`, `getOversightDir`, `findOversightDir`

**CI / Publishing**
- GitHub Actions: CI matrix (Node 18/20/22 × Linux/macOS/Windows), release pipeline (npm + GitHub Packages + GitHub Release), benchmark regression guard
- Dependabot for npm and GitHub Actions
- MIT license

[0.1.3]: https://github.com/rudraptpsingh/oversight/releases/tag/v0.1.3
[0.1.2]: https://github.com/rudraptpsingh/oversight/releases/tag/v0.1.2
[0.1.1]: https://github.com/rudraptpsingh/oversight/releases/tag/v0.1.1
[0.1.0]: https://github.com/rudraptpsingh/oversight/releases/tag/v0.1.0
