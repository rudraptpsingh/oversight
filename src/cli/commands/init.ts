import { Command } from "commander"
import inquirer from "inquirer"
import { execSync } from "child_process"
import fs from "fs"
import path from "path"
import { writeConfig, findWhycodeDir } from "../../utils/config.js"
import { initDb } from "../../db/schema.js"
import { logger } from "../../utils/logger.js"

function getGitAuthor(): string {
  try {
    return execSync("git config user.name", { encoding: "utf-8" }).trim()
  } catch {
    return ""
  }
}

export function registerInit(program: Command): void {
  program
    .command("init")
    .description("Initialize WhyCode in the current repository")
    .action(async () => {
      const cwd = process.cwd()
      const existing = findWhycodeDir(cwd)
      const isReinit = existing === path.join(cwd, ".whycode")

      if (isReinit) {
        const { confirm } = await inquirer.prompt([
          {
            type: "confirm",
            name: "confirm",
            message: "WhyCode is already initialized. Reinitialize?",
            default: false,
          },
        ])
        if (!confirm) {
          logger.info("Aborted.")
          return
        }
      }

      const defaultAuthor = getGitAuthor()
      const { author } = await inquirer.prompt([
        {
          type: "input",
          name: "author",
          message: "Author name:",
          default: defaultAuthor,
          validate: (v: string) => v.trim().length > 0 || "Author name is required",
        },
      ])

      const whycodeDir = path.join(cwd, ".whycode")
      fs.mkdirSync(whycodeDir, { recursive: true })

      writeConfig(
        {
          version: "1.0.0",
          author: author.trim(),
          repoRoot: cwd,
          createdAt: new Date().toISOString(),
        },
        cwd
      )

      initDb(whycodeDir)

      fs.writeFileSync(
        path.join(whycodeDir, ".gitignore"),
        "decisions.db-journal\ndecisions.db-shm\ndecisions.db-wal\n",
        "utf-8"
      )

      logger.success("WhyCode initialized successfully!")
      console.log("")
      logger.info("Next steps:")
      console.log("  • whycode capture          — record a decision")
      console.log("  • whycode list             — view all decisions")
      console.log("  • whycode check <path>     — check decisions for a file")
      console.log("  • whycode hooks install    — enable git post-commit reminders")
      console.log("")
    })
}
