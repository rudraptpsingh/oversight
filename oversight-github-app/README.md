# Oversight GitHub App

Enforces architectural constraints on pull requests and pushes.

## What it does

- On every PR open/update: downloads `decisions.db` from base branch, checks changed files against MUST constraints, posts a GitHub Check Run, and comments on violations
- Required GitHub App permissions: `contents:read`, `pull_requests:write`, `checks:write`

## Setup

1. Create a GitHub App at https://github.com/settings/apps/new
2. Set permissions: `Contents: Read`, `Pull requests: Write`, `Checks: Write`
3. Subscribe to events: `Pull request`, `Push`
4. Copy `.env.example` to `.env` and fill in credentials
5. `npm install && npm run dev`

## Local development

Uses smee.io to forward GitHub webhooks to localhost:

```sh
npx smee -u https://smee.io/your-channel --path /api/github/webhooks --port 3000
npm run dev
```
