import type { Database } from "../../db/adapter.js"
import { onOverride, classifyOverrideIntent } from "../../engine/confidence.js"

/** Minimum rationale length to prevent vacuous overrides — per seed-override-rationale-min. */
const MIN_RATIONALE_LENGTH = 10

export const overrideTool = {
  name: "oversight_override",
  description:
    "Record a deliberate override of a constraint. Requires a meaningful rationale (min 10 chars). Updates confidence scores and logs override intent for analysis.",
  inputSchema: {
    type: "object" as const,
    properties: {
      constraintDescription: {
        type: "string",
        description: "The exact constraint description being overridden",
      },
      decisionId: {
        type: "string",
        description: "ID of the decision that owns the constraint",
      },
      rationale: {
        type: "string",
        description: "Why you are overriding this constraint (min 10 characters)",
      },
      commitSha: {
        type: "string",
        description: "Optional current commit SHA for audit trail",
      },
    },
    required: ["constraintDescription", "decisionId", "rationale"],
  },
}

export function handleOverride(
  db: Database,
  input: {
    constraintDescription: string
    decisionId: string
    rationale: string
    commitSha?: string
  }
): {
  success: boolean
  error?: string
  intentClass?: string
  constraintId?: number
  newConfidence?: number
} {
  if (!input.rationale || input.rationale.trim().length < MIN_RATIONALE_LENGTH) {
    return {
      success: false,
      error: `Rationale too short. Provide at least ${MIN_RATIONALE_LENGTH} characters explaining why you are overriding this constraint.`,
    }
  }

  const row = db.prepare(
    "SELECT id, confidence FROM constraints WHERE decision_id = ? AND LOWER(TRIM(description)) = LOWER(TRIM(?))"
  ).get(input.decisionId, input.constraintDescription) as
    | { id: number; confidence: number }
    | undefined

  if (!row) {
    return {
      success: false,
      error: `Constraint not found for decision "${input.decisionId}" with description "${input.constraintDescription}".`,
    }
  }

  onOverride(db, row.id, input.rationale.trim(), input.commitSha)

  const updated = db.prepare("SELECT confidence FROM constraints WHERE id = ?").get(row.id) as
    | { confidence: number }
    | undefined

  const intentClass = classifyOverrideIntent(input.rationale.trim())

  return {
    success: true,
    constraintId: row.id,
    intentClass,
    newConfidence: updated?.confidence,
  }
}
