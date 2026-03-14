#!/usr/bin/env node
import { Command } from "commander"
import { createRequire } from "module"
import { registerInit } from "./commands/init.js"
import { registerCapture } from "./commands/capture.js"
import { registerList } from "./commands/list.js"
import { registerCheck } from "./commands/check.js"
import { registerReview } from "./commands/review.js"
import { registerHeatmap } from "./commands/heatmap.js"
import { registerHooks } from "./commands/hooks.js"

const require = createRequire(import.meta.url)
const pkg = require("../../package.json") as { version: string; description: string }

const program = new Command()

program
  .name("whycode")
  .description(pkg.description)
  .version(pkg.version)

registerInit(program)
registerCapture(program)
registerList(program)
registerCheck(program)
registerReview(program)
registerHeatmap(program)
registerHooks(program)

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(String(err))
  process.exit(1)
})
