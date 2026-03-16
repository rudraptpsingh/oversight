import type { Command } from "commander"
import { createDashboardServer } from "../../dashboard/server.js"

export function registerDashboard(program: Command): void {
  program
    .command("dashboard")
    .description("Open the visual decision dashboard at http://localhost:7654")
    .option("-p, --port <number>", "Port to run the dashboard on", "7654")
    .option("-d, --dir <path>", "Directory containing the .oversight folder")
    .option("--no-open", "Do not automatically open the browser")
    .action(async (opts: { port: string; dir?: string; open: boolean }) => {
      const port = parseInt(opts.port, 10)

      let server: { start: () => Promise<void>; stop: () => void }
      try {
        server = await createDashboardServer(port, opts.dir)
      } catch (err: unknown) {
        console.error(String(err))
        process.exit(1)
      }

      await server.start()

      const url = `http://localhost:${port}`
      console.log(`\n  Oversight Dashboard running at ${url}\n`)
      console.log(`  Press Ctrl+C to stop\n`)

      if (opts.open !== false) {
        try {
          const open = await import("node:child_process")
          const platform = process.platform
          const cmd =
            platform === "darwin" ? "open" : platform === "win32" ? "start" : "xdg-open"
          open.spawn(cmd, [url], { stdio: "ignore", detached: true }).unref()
        } catch {
        }
      }

      process.on("SIGINT", () => {
        server.stop()
        process.exit(0)
      })

      process.on("SIGTERM", () => {
        server.stop()
        process.exit(0)
      })

      await new Promise(() => {})
    })
}
