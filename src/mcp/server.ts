#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"
import { createRequire } from "module"
import { getWhycodeDir } from "../utils/config.js"
import { getDb } from "../db/schema.js"
import { getByPathTool, handleGetByPath } from "./tools/getByPath.js"
import { getBySymbolTool, handleGetBySymbol } from "./tools/getBySymbol.js"
import { searchTool, handleSearch } from "./tools/search.js"
import { recordTool, handleRecord } from "./tools/record.js"
import { checkChangeTool, handleCheckChange } from "./tools/checkChange.js"

const require = createRequire(import.meta.url)
const pkg = require("../../package.json") as { version: string }

const server = new Server(
  { name: "whycode", version: pkg.version },
  { capabilities: { tools: {} } }
)

const whycodeDir = getWhycodeDir()
const db = getDb(whycodeDir)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [getByPathTool, getBySymbolTool, searchTool, recordTool, checkChangeTool],
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params
  const input = (args ?? {}) as Record<string, unknown>

  try {
    let result: unknown

    switch (name) {
      case "whycode_get_by_path":
        result = handleGetByPath(db, input as Parameters<typeof handleGetByPath>[1])
        break
      case "whycode_get_by_symbol":
        result = handleGetBySymbol(db, input as Parameters<typeof handleGetBySymbol>[1])
        break
      case "whycode_search":
        result = handleSearch(db, input as Parameters<typeof handleSearch>[1])
        break
      case "whycode_record":
        result = handleRecord(db, input as Parameters<typeof handleRecord>[1])
        break
      case "whycode_check_change":
        result = handleCheckChange(db, input as Parameters<typeof handleCheckChange>[1])
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

async function main(): Promise<void> {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  process.stderr.write("WhyCode MCP server running on stdio\n")
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${String(err)}\n`)
  process.exit(1)
})
