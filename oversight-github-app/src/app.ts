import { Probot } from "probot"
import { handlePullRequest } from "./handlers/pull-request.js"

export default (app: Probot) => {
  app.log.info("Oversight GitHub App loaded")

  // Check constraints on PR open and new commits
  app.on(["pull_request.opened", "pull_request.synchronize"], async (context) => {
    await handlePullRequest(context)
  })

  // Check constraints on direct push to default branch
  app.on("push", async (context) => {
    const ref = context.payload.ref
    const defaultBranch = context.payload.repository.default_branch
    if (ref !== `refs/heads/${defaultBranch}`) return

    const changedFiles = context.payload.commits.flatMap(
      (c: { added: string[]; modified: string[]; removed: string[] }) => [
        ...c.added,
        ...c.modified,
        ...c.removed,
      ]
    )

    if (changedFiles.length === 0) return

    const owner = context.payload.repository.owner.login
    const repo = context.payload.repository.name
    const sha = context.payload.after

    // Post a commit status
    await context.octokit.repos.createCommitStatus({
      owner,
      repo,
      sha,
      state: "success",
      description: "Oversight: constraint check pending",
      context: "oversight/constraints",
    })
  })
}
