import { createServer, IncomingMessage, ServerResponse } from "node:http"
import { readFileSync, existsSync } from "node:fs"
import { join, extname } from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { getDb } from "../db/schema.js"
import type { Database } from "../db/schema.js"
import { getAllDecisions, getDecisionById, updateDecision, deleteDecision } from "../db/decisions.js"
import { searchDecisions } from "../db/search.js"
import { computeMetrics } from "../db/metrics.js"
import { getOversightDir } from "../utils/config.js"
import type { SearchOptions, DecisionStatus, DecisionType } from "../types/index.js"

const require = createRequire(import.meta.url)
const __dirname = fileURLToPath(new URL(".", import.meta.url))

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
}

function cors(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")
}

function json(res: ServerResponse, data: unknown, status = 200): void {
  cors(res)
  res.writeHead(status, { "Content-Type": "application/json" })
  res.end(JSON.stringify(data))
}

function parseBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = ""
    req.on("data", (chunk) => (body += chunk.toString()))
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {})
      } catch {
        reject(new Error("Invalid JSON"))
      }
    })
    req.on("error", reject)
  })
}

function serveStatic(res: ServerResponse, filePath: string): boolean {
  if (!existsSync(filePath)) return false
  try {
    const ext = extname(filePath)
    const mimeType = MIME_TYPES[ext] ?? "application/octet-stream"
    const content = readFileSync(filePath)
    cors(res)
    res.writeHead(200, { "Content-Type": mimeType })
    res.end(content)
    return true
  } catch {
    return false
  }
}

export async function createDashboardServer(port = 7654, startDir?: string): Promise<{ start: () => Promise<void>; stop: () => void }> {
  const distDir = join(__dirname, "../../dashboard-ui/dist")
  let db: Database

  try {
    const oversightDir = getOversightDir(startDir ?? process.cwd())
    db = await getDb(oversightDir)
  } catch {
    throw new Error("Oversight is not initialized in this directory. Run `oversight init` first.")
  }

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`)
    const pathname = url.pathname

    if (req.method === "OPTIONS") {
      cors(res)
      res.writeHead(204)
      res.end()
      return
    }

    if (pathname.startsWith("/api/")) {
      await handleApi(req, res, url, db)
      return
    }

    if (pathname === "/" || !pathname.includes(".")) {
      const indexPath = join(distDir, "index.html")
      if (serveStatic(res, indexPath)) return
      cors(res)
      res.writeHead(200, { "Content-Type": "text/html" })
      res.end(fallbackHtml(port))
      return
    }

    const staticPath = join(distDir, pathname)
    if (!serveStatic(res, staticPath)) {
      json(res, { error: "Not found" }, 404)
    }
  })

  async function handleApi(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    db: Database
  ): Promise<void> {
    const pathname = url.pathname
    const method = req.method ?? "GET"

    try {
      if (pathname === "/api/decisions" && method === "GET") {
        const status = url.searchParams.get("status") as DecisionStatus | null
        const q = url.searchParams.get("q")
        const tags = url.searchParams.get("tags")?.split(",").filter(Boolean)
        const types = url.searchParams.get("types")?.split(",").filter(Boolean) as DecisionType[] | undefined
        const limit = parseInt(url.searchParams.get("limit") ?? "100", 10)

        if (q || tags || types) {
          const opts: SearchOptions = {
            query: q ?? undefined,
            tags,
            decisionTypes: types,
            status: status ?? undefined,
            limit,
          }
          json(res, searchDecisions(db, opts))
        } else {
          json(res, getAllDecisions(db, status ?? undefined))
        }
        return
      }

      if (pathname.startsWith("/api/decisions/") && method === "GET") {
        const id = pathname.replace("/api/decisions/", "")
        const decision = getDecisionById(db, id)
        if (!decision) {
          json(res, { error: "Not found" }, 404)
          return
        }
        json(res, decision)
        return
      }

      if (pathname.startsWith("/api/decisions/") && method === "PATCH") {
        const id = pathname.replace("/api/decisions/", "")
        const body = await parseBody(req)
        const updated = updateDecision(db, id, body as Parameters<typeof updateDecision>[2])
        if (!updated) {
          json(res, { error: "Not found" }, 404)
          return
        }
        json(res, updated)
        return
      }

      if (pathname.startsWith("/api/decisions/") && method === "DELETE") {
        const id = pathname.replace("/api/decisions/", "")
        const ok = deleteDecision(db, id)
        json(res, { ok }, ok ? 200 : 404)
        return
      }

      if (pathname === "/api/metrics" && method === "GET") {
        json(res, computeMetrics(db))
        return
      }

      if (pathname === "/api/search" && method === "GET") {
        const q = url.searchParams.get("q") ?? ""
        const limit = parseInt(url.searchParams.get("limit") ?? "20", 10)
        json(res, searchDecisions(db, { query: q, limit }))
        return
      }

      json(res, { error: "Not found" }, 404)
    } catch (err) {
      json(res, { error: String(err) }, 500)
    }
  }

  return {
    start: () =>
      new Promise<void>((resolve) => {
        server.listen(port, "127.0.0.1", () => resolve())
      }),
    stop: () => server.close(),
  }
}

function fallbackHtml(port: number): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Oversight Dashboard</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f1117; color: #e2e8f0; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
  .card { background: #1a1f2e; border: 1px solid #2d3748; border-radius: 12px; padding: 40px; max-width: 480px; text-align: center; }
  h1 { font-size: 1.5rem; font-weight: 700; color: #fff; margin-bottom: 8px; }
  p { color: #94a3b8; font-size: 0.95rem; line-height: 1.6; margin-bottom: 20px; }
  code { background: #2d3748; padding: 4px 8px; border-radius: 4px; font-size: 0.85rem; color: #63b3ed; }
</style>
</head>
<body>
<div class="card">
  <h1>Oversight Dashboard</h1>
  <p>API server is running on port ${port}.</p>
  <p>Build the dashboard UI with <code>npm run build:dashboard</code> or run the full dev server.</p>
  <p>API available at <code>http://localhost:${port}/api/decisions</code></p>
</div>
</body>
</html>`
}
