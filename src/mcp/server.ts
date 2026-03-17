#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"
import { createRequire } from "module"
import { getOversightDir } from "../utils/config.js"
import { getDb } from "../db/schema.js"
import type { Database } from "../db/schema.js"
import { getByPathTool, handleGetByPath } from "./tools/getByPath.js"
import { getBySymbolTool, handleGetBySymbol } from "./tools/getBySymbol.js"
import { retrieveConstraintsTool, handleRetrieveConstraints } from "./tools/retrieveConstraints.js"
import { searchTool, handleSearch } from "./tools/search.js"
import { recordTool, handleRecord } from "./tools/record.js"
import { checkChangeTool, handleCheckChange } from "./tools/checkChange.js"
import { metricsTool, handleGetMetrics } from "./tools/metrics.js"
import { findSimilarTool, handleFindSimilar } from "./tools/findSimilar.js"
import { captureConversationTool, handleCaptureConversation } from "./tools/captureConversation.js"
import { mergeTool, handleMerge } from "./tools/merge.js"
import { sessionStartTool, handleSessionStart } from "./tools/sessionStart.js"
import { sessionEndTool, handleSessionEnd } from "./tools/sessionEnd.js"
import { generateHandoffTool, handleGenerateHandoff, receiveHandoffTool, handleReceiveHandoff } from "./tools/handoff.js"
import { overrideTool, handleOverride } from "./tools/override.js"
import { getSessionReportTool, handleGetSessionReport } from "./tools/getSessionReport.js"

const require = createRequire(import.meta.url)
const pkg = require("../../package.json") as { version: string }

const server = new Server(
  { name: "oversight", version: pkg.version },
  { capabilities: { tools: {} } }
)

async function main(): Promise<void> {
  const oversightDir = getOversightDir()
  const db: Database = await getDb(oversightDir)

  const logPath = path.join(oversightDir, "mcp-invocations.log")
  fs.appendFileSync(logPath, `[${new Date().toISOString()}] Oversight MCP server started (local build)\n`, "utf-8")

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      sessionStartTool,
      sessionEndTool,
      getByPathTool,
      getBySymbolTool,
      retrieveConstraintsTool,
      searchTool,
      recordTool,
      checkChangeTool,
      metricsTool,
      findSimilarTool,
      captureConversationTool,
      mergeTool,
      generateHandoffTool,
      receiveHandoffTool,
      overrideTool,
      getSessionReportTool,
    ],
  }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params
    const input = (args ?? {}) as Record<string, unknown>

    try {
      fs.appendFileSync(logPath, `${new Date().toISOString()} ${name}\n`, "utf-8")
    } catch {
      // best-effort logging
    }

    try {
      let result: unknown

      switch (name) {
        case "oversight_session_start":
          result = handleSessionStart(db, input as Parameters<typeof handleSessionStart>[1])
          break
        case "oversight_session_end":
          result = handleSessionEnd(db, input as Parameters<typeof handleSessionEnd>[1])
          break
        case "oversight_get_by_path":
          result = handleGetByPath(db, input as Parameters<typeof handleGetByPath>[1])
          break
        case "oversight_get_by_symbol":
          result = handleGetBySymbol(db, input as Parameters<typeof handleGetBySymbol>[1])
          break
        case "oversight_retrieve_constraints":
          result = handleRetrieveConstraints(db, input as Parameters<typeof handleRetrieveConstraints>[1])
          break
        case "oversight_search":
          result = handleSearch(db, input as Parameters<typeof handleSearch>[1])
          break
        case "oversight_record":
          result = handleRecord(db, input as Parameters<typeof handleRecord>[1])
          break
        case "oversight_check_change":
          result = handleCheckChange(db, input as Parameters<typeof handleCheckChange>[1])
          break
        case "oversight_get_metrics":
          result = handleGetMetrics(db)
          break
        case "oversight_find_similar":
          result = handleFindSimilar(db, input as Parameters<typeof handleFindSimilar>[1])
          break
        case "oversight_capture_conversation":
          result = await handleCaptureConversation(db, input as Parameters<typeof handleCaptureConversation>[1])
          break
        case "oversight_merge":
          result = handleMerge(db, input as Parameters<typeof handleMerge>[1])
          break
        case "oversight_generate_handoff":
          result = handleGenerateHandoff(db, input as Parameters<typeof handleGenerateHandoff>[1])
          break
        case "oversight_receive_handoff":
          result = handleReceiveHandoff(db, input as Parameters<typeof handleReceiveHandoff>[1])
          break
        case "oversight_override":
          result = handleOverride(db, input as Parameters<typeof handleOverride>[1])
          break
        case "oversight_get_session_report":
          result = handleGetSessionReport(null, input as Parameters<typeof handleGetSessionReport>[1])
          break
        default:
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ error: `Unknown tool: ${name}` }) }],
            isError: true,
          }
      }

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      }
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: String(err) }) }],
        isError: true,
      }
    }
  })

  const transport = new StdioServerTransport()
  await server.connect(transport)
  process.stderr.write("Oversight MCP server running on stdio\n")
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${String(err)}\n`)
  process.exit(1)
})
