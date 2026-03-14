import { Command } from "commander"
import { installHooks, uninstallHooks } from "../../git/hooks.js"
import { logger } from "../../utils/logger.js"

export function registerHooks(program: Command): void {
  const hooks = program.command("hooks").description("Manage git hooks")

  hooks
    .command("install")
    .description("Install WhyCode post-commit git hook")
    .action(async () => {
      try {
        installHooks(process.cwd())
        logger.success("WhyCode git hook installed.")
        logger.info("After each commit, you'll be reminded to check decisions for modified files.")
      } catch (err) {
        logger.error(`Failed to install hook: ${String(err)}`)
      }
    })

  hooks
    .command("uninstall")
    .description("Remove WhyCode post-commit git hook")
    .action(async () => {
      try {
        uninstallHooks(process.cwd())
        logger.success("WhyCode git hook removed.")
      } catch (err) {
        logger.error(`Failed to uninstall hook: ${String(err)}`)
      }
    })
}
