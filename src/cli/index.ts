#!/usr/bin/env node
import { Command } from "commander"
import { createRequire } from "module"
import { findOversightDir } from "../utils/config.js"
import { ensureInitNonInteractive } from "./commands/init.js"
import { registerInit } from "./commands/init.js"
import { registerCapture } from "./commands/capture.js"
import { registerList } from "./commands/list.js"
import { registerCheck } from "./commands/check.js"
import { registerReview } from "./commands/review.js"
import { registerHeatmap } from "./commands/heatmap.js"
import { registerHooks } from "./commands/hooks.js"
import { registerMetrics } from "./commands/metrics.js"
import { registerDashboard } from "./commands/dashboard.js"
import { registerGenerate } from "./commands/generate.js"
import { registerExport } from "./commands/export.js"
import { registerEnforce } from "./commands/enforce.js"
import { registerSearch } from "./commands/search.js"

const require = createRequire(import.meta.url)
const pkg = require("../../package.json") as { version: string; description: string }

const program = new Command()

program
  .name("oversight")
  .description(pkg.description)
  .version(pkg.version)

// Auto-init on first use (when running any command except init)
const cmd = process.argv[2]
if (cmd && cmd !== "init" && !findOversightDir(process.cwd())) {
  ensureInitNonInteractive().then((didInit) => {
    if (didInit) console.log("Oversight: initialized .oversight/ (first run)")
  }).catch(() => {})
}

registerInit(program)
registerCapture(program)
registerList(program)
registerCheck(program)
registerReview(program)
registerHeatmap(program)
registerHooks(program)
registerMetrics(program)
registerDashboard(program)
registerGenerate(program)
registerExport(program)
registerEnforce(program)
registerSearch(program)

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(String(err))
  process.exit(1)
})
