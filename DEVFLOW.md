# Development Flow — Build by Testing

This guide describes how to keep Oversight healthy while making changes and commits. **Build by testing** — run checks continuously so issues surface immediately.

---

## Quick Start (First Time)

```bash
npm install
npm run build
npm test

# Oversight auto-initializes on first use (npx oversight list, etc.)
# Or run explicitly: npx oversight init --yes
# Optional: install git hook reminders
npx oversight hooks install
```

---

## Before Making Changes

1. **Check affected files** — before editing, see what decisions anchor to your target path:
   ```bash
   npx oversight check src/path/to/file.ts
   ```

2. **Run the test suite** to establish a baseline:
   ```bash
   npm test
   ```

---

## While Developing

- **Capture decisions** when you make architectural choices, add constraints, or fix incidents:
  ```bash
  npx oversight capture
  ```

- **Run tests in watch mode** for fast feedback:
  ```bash
  npm run test:watch
  ```

- **Assess risk** before large refactors (MCP or CLI):
  ```bash
  npx oversight check src/db/schema.ts
  ```

---

## Before Each Commit

Run this checklist:

```bash
npm run precommit
```

This runs `build` and `test`. Fix any failures before committing.

If tests fail, fix before committing. Do not commit broken tests.

---

## Tracking Performance & Issues

### 1. Metrics After Each Session

Periodically run:

```bash
npx oversight metrics
```

Watch for:
- **Total decisions** — growing as you document constraints
- **MUST constraints** — critical invariants
- **Change risk assessments** — history of `oversight_check_change` calls
- **Coverage** — files protected by decision anchors

### 2. Dashboard for Visual Monitoring

```bash
npx oversight dashboard
```

Opens **http://localhost:7654**. View:
- Decision timeline
- Constraint density
- Coverage heatmap
- Recent agent checks

### 3. Test Coverage

```bash
npm run test:coverage
```

Keep coverage from regressing. Add tests for new behavior.

### 4. When Issues Arise

| Symptom | Action |
|--------|--------|
| Tests fail | Fix or revert before committing |
| Build fails | Fix TypeScript/lint errors |
| `oversight check` shows HIGH risk | Review constraints; either update the change or update the decision record |
| Metrics show 0 decisions | Run `oversight capture` for key architectural choices |
| Dashboard shows stale decisions | Run `oversight review` to step through decisions needing updates |

### 5. Git Hook Reminder

After installing `npx oversight hooks install`, every commit will remind you to:

- Run `oversight check <path>` for modified files that have anchored decisions
- Capture new decisions if you made architectural choices

---

## Commands Cheat Sheet

| Command | When to use |
|---------|-------------|
| `npm run precommit` | Before every commit (build + test) |
| `npm test` | Run tests |
| `npm run build` | After changing TypeScript |
| `npx oversight check <path>` | Before editing a file |
| `npx oversight capture` | After making a decision |
| `npx oversight list` | Inspect all decisions |
| `npx oversight metrics` | Track coverage and constraints |
| `npx oversight dashboard` | Visual overview |
| `npx oversight review` | Staleness check |

---

## Dogfooding: Oversight on Itself

This repo uses Oversight to track its own architectural decisions. As you change core modules (`src/db/`, `src/mcp/`, etc.):

1. Run `npx oversight check src/db/schema.ts` (or the file you're editing)
2. If you change storage, MCP tools, or CLI behavior, consider `oversight capture`
3. Run `node scripts/self-test.mjs` after schema or MCP changes (creates its own test DB at `.whycode/`)

This keeps the tool validated against its own decision memory.
