import type { Database } from "../../db/adapter.js"
import { getDecisionById, updateDecision } from "../../db/decisions.js"

export const promoteTool = {
  name: "oversight_promote",
  description:
    "Promote a SHOULD constraint to MUST (human-triggered). Use when you're confident a constraint should be enforced strictly. Auto-promotion also happens at confidence>0.9 + check_count>20.",
  inputSchema: {
    type: "object" as const,
    properties: {
      decisionId: { type: "string", description: "ID of the decision that owns the constraint" },
      constraintDescription: { type: "string", description: "Exact description of the constraint to promote" },
      rationale: { type: "string", description: "Why you are promoting this to MUST (min 10 chars)" },
    },
    required: ["decisionId", "constraintDescription", "rationale"],
  },
}

export function handlePromote(
  db: Database,
  input: { decisionId: string; constraintDescription: string; rationale: string }
): { success: boolean; error?: string; previousSeverity?: string } {
  if (!input.rationale || input.rationale.trim().length < 10) {
    return { success: false, error: "Rationale too short. Provide at least 10 characters." }
  }

  const decision = getDecisionById(db, input.decisionId)
  if (!decision) {
    return { success: false, error: `Decision "${input.decisionId}" not found.` }
  }

  const key = input.constraintDescription.toLowerCase().trim()
  const idx = decision.constraints.findIndex((c) => c.description.toLowerCase().trim() === key)

  if (idx === -1) {
    return {
      success: false,
      error: `Constraint not found in decision "${input.decisionId}": "${input.constraintDescription}"`,
    }
  }

  const prev = decision.constraints[idx]
  if (prev.severity === "must") {
    return { success: false, error: "Constraint is already MUST severity.", previousSeverity: "must" }
  }

  const updated = [...decision.constraints]
  updated[idx] = { ...prev, severity: "must", rationale: prev.rationale || input.rationale }

  updateDecision(db, input.decisionId, { constraints: updated })

  // Also update constraints table directly for immediate confidence history
  const row = db.prepare(
    "SELECT id FROM constraints WHERE decision_id = ? AND LOWER(TRIM(description)) = LOWER(TRIM(?))"
  ).get(input.decisionId, input.constraintDescription) as { id: number } | undefined

  if (row) {
    db.prepare("UPDATE constraints SET severity = 'must' WHERE id = ?").run(row.id)
    db.prepare(
      "INSERT INTO constraint_confidence_history (constraint_id, confidence, recorded_at, event_type) SELECT id, confidence, ?, 'promote' FROM constraints WHERE id = ?"
    ).run(Date.now(), row.id)
  }

  return { success: true, previousSeverity: prev.severity }
}
