# Contributing to Oversight

## Getting Started

```bash
git clone https://github.com/rudraptpsingh/oversight
cd oversight
npm install
npm run build
npm test
```

## Running the Dashboard

**Production** (opens http://localhost:7654):
```bash
npx oversight dashboard
```

**Dev mode** (hot-reload Vite on :5174, proxies /api to :7654):
```bash
npm run build          # compile TypeScript CLI first
npm run dev:dashboard  # Vite dev server
```

In a separate terminal, start the API server in a test repo:
```bash
npx oversight init       # in a test directory
npx tsx src/cli/index.ts dashboard --port 7654
```

## Project Structure

```
src/
  cli/commands/    One file per CLI command
  db/              SQLite queries (decisions, metrics, search, schema)
  ai/              AI-assisted capture and staleness detection
  mcp/tools/       One file per MCP tool
  dashboard/       HTTP API server for the web dashboard
  utils/           Config, logger, anchor helpers
  types/           Shared TypeScript types

dashboard-ui/      Vite + React dashboard app
  src/
    pages/         OverviewPage, DecisionsPage, DecisionDetailPage
    components/    Sidebar, Badge, StatCard
    api.ts         Fetch helpers calling /api/*

tests/
  unit/            Pure function tests
  integration/     Tests requiring a real SQLite database
```

## Adding a New MCP Tool

1. Create `src/mcp/tools/myTool.ts` exporting `myToolDefinition` and `handleMyTool`
2. Register it in `src/mcp/server.ts`
3. Add a test in `tests/integration/mcp.tools.test.ts`

## Submitting Benchmarks

Benchmarks live in `benchmarks/`. A good benchmark:
- Uses a real framework pattern (Next.js, Express, Django, etc.)
- Has 2-4 constraints pre-loaded into Oversight
- Runs two simulated agents (A without Oversight, B with Oversight)
- Produces measurable, reproducible results
- Documents the real-world incident or CVE it is based on

## Tests

```bash
npm test                # run all tests once
npm run test:watch      # watch mode
npm run test:coverage   # coverage report
```

## Code Style

- TypeScript strict mode throughout
- No comments unless the logic is non-obvious
- Follow the existing file structure patterns
- Each file has one clear responsibility
