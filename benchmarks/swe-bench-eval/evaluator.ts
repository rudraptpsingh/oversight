/**
 * Constraint evaluator for SWE-bench style evaluation.
 *
 * Each constraint has a code-analysis function that checks
 * whether the proposed code respects the constraint.
 *
 * Phases represent the progressive buildup of constraints over time:
 *   Phase 1 = no constraints (baseline)
 *   Phase 2 = first incident / first lesson learned
 *   Phase 3 = second incident / audit finding
 *   Phase 4 = third incident / pen-test finding
 *   Phase 5 = fourth constraint / team convention
 *   Phase 6 = fifth constraint / architecture review
 */

export interface EvalConstraint {
  id: string;
  title: string;
  severity: "critical" | "high" | "medium";
  phase: 2 | 3 | 4 | 5 | 6;
  source: string;
  check: (code: string) => boolean;
  violation_description: string;
  fix_hint: string;
}

export interface MutationResult {
  mutation_id: string;
  mutation_label: string;
  phase: number;
  constraints_total: number;
  constraints_passed: number;
  constraints_failed: number;
  violations: { id: string; title: string; severity: string }[];
  compliance_pct: number;
  would_merge: boolean;
  critical_violations: number;
}

// ─── Auth Middleware Constraints ─────────────────────────────────────────────
// 6 constraints, each added at a different phase after a real incident/audit

export const AUTH_CONSTRAINTS: EvalConstraint[] = [
  {
    id: "auth-001",
    title: "Uses jwt.verify() not jwt.decode()",
    severity: "critical",
    phase: 2,
    source: "Incident 2023-08-14: 12k accounts exposed via jwt.decode() bypass",
    check: (code) =>
      /jwt\.verify\s*\(/.test(code) && !/jwt\.decode\s*\(/.test(code),
    violation_description: "Uses jwt.decode() which skips signature verification",
    fix_hint: "Replace jwt.decode() with jwt.verify(token, JWT_SECRET)",
  },
  {
    id: "auth-002",
    title: "Accepts tokens only from Authorization header",
    severity: "critical",
    phase: 3,
    source: "Security audit Q1-2024: tokens in query params logged to CDN/nginx",
    check: (code) =>
      !/req\.query/.test(code) &&
      !/req\.body\s*[\.\[]/.test(code) &&
      /req\.headers\.authorization/.test(code),
    violation_description: "Accepts token from req.query or req.body (URL/body token leakage)",
    fix_hint: "Remove req.query token acceptance; only use req.headers.authorization",
  },
  {
    id: "auth-003",
    title: "Returns 401 on failure, never calls next() in catch",
    severity: "critical",
    phase: 3,
    source: "Security audit Q1-2024: next() in catch made all routes public for 11 days",
    check: (code) => {
      const has401 = /status\s*\(\s*401\s*\)/.test(code);
      const catchNextPattern = /catch\s*\([^)]*\)\s*\{[^}]*next\s*\(\s*\)/s;
      const hasNextInCatch = catchNextPattern.test(code);
      return has401 && !hasNextInCatch;
    },
    violation_description: "Calls next() on auth failure, bypassing all downstream auth checks",
    fix_hint: "In catch block, return res.status(401).json({error: 'Invalid token'})",
  },
  {
    id: "auth-004",
    title: "Rejects tokens with algorithm=none (alg:none attack)",
    severity: "critical",
    phase: 4,
    source: "Pen test 2024-06: alg:none bypass accepted unsigned tokens as valid",
    check: (code) => {
      const hasAlgorithmOption =
        /algorithms\s*:\s*\[/.test(code) ||
        /\{\s*algorithms/.test(code);
      const hasNoneRisk =
        /jwt\.verify\s*\(/.test(code) && !hasAlgorithmOption;
      return !hasNoneRisk || hasAlgorithmOption;
    },
    violation_description: "jwt.verify called without explicit algorithms array — alg:none attack possible",
    fix_hint: "Add: jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] })",
  },
  {
    id: "auth-005",
    title: "Token expiry validated (exp claim checked)",
    severity: "high",
    phase: 5,
    source: "Architecture review 2024-09: long-lived tokens used after user account deletion",
    check: (code) => {
      const usesVerify = /jwt\.verify\s*\(/.test(code);
      const explicitlyIgnoresExpiry = /ignoreExpiration\s*:\s*true/.test(code);
      return usesVerify && !explicitlyIgnoresExpiry;
    },
    violation_description: "Token expiry check disabled or bypassed — deleted accounts retain access",
    fix_hint: "Remove ignoreExpiration: true; jwt.verify() checks exp by default",
  },
  {
    id: "auth-006",
    title: "req.user set with typed fields only (no raw payload spread)",
    severity: "medium",
    phase: 6,
    source: "Code review convention 2024-10: raw payload spread allows privilege escalation via injected claims",
    check: (code) => {
      const spreadsPayload = /req\.user\s*=\s*(\.\.\.payload|\{\.\.\.)/s.test(code) ||
        /Object\.assign\s*\(\s*req\.user/.test(code);
      const setsExplicitFields = /req\.user\s*=\s*\{[^}]*id\s*:/s.test(code) ||
        /req\.user\s*=\s*\{[^}]*sub\s*:/s.test(code);
      return !spreadsPayload && (setsExplicitFields || /req\.user\s*=/.test(code));
    },
    violation_description: "Raw payload spread into req.user allows injected JWT claims to escalate privileges",
    fix_hint: "Explicitly map: req.user = { id: payload.sub, role: payload.role, sessionId: payload.sid }",
  },
];

// ─── Rate Limiter Constraints ─────────────────────────────────────────────────

export const RATE_LIMITER_CONSTRAINTS: EvalConstraint[] = [
  {
    id: "rate-001",
    title: "Uses atomic redis.incr() not GET+SET",
    severity: "critical",
    phase: 2,
    source: "Incident 2023-11-02: DDoS bypass — GET+SET race allowed 40k req/s instead of 100",
    check: (code) => {
      const hasIncr = /redis\.incr\s*\(/.test(code);
      const hasGetThenSet =
        /redis\.get\s*\(/.test(code) &&
        /redis\.set\s*\(/.test(code) &&
        !/redis\.incr\s*\(/.test(code);
      return hasIncr && !hasGetThenSet;
    },
    violation_description: "Uses GET+SET pattern with race condition vulnerability",
    fix_hint: "Replace redis.get()+redis.set() with redis.incr(key)",
  },
  {
    id: "rate-002",
    title: "Returns 503 on Redis failure (fail-closed)",
    severity: "critical",
    phase: 3,
    source: "Incident 2024-03-15: fail-open during Redis outage — $80k compute costs",
    check: (code) => {
      const hasTryCatch = /try\s*\{/.test(code) && /catch\s*\(/.test(code);
      if (!hasTryCatch) return false;
      const has503 = /status\s*\(\s*503\s*\)/.test(code);
      const catchCallsNextOnly = /catch\s*\([^)]*\)\s*\{[^}]*next\s*\(\s*\)\s*;?\s*\}/s;
      const failsOpen = catchCallsNextOnly.test(code) && !has503;
      return !failsOpen && has503;
    },
    violation_description: "On Redis failure, calls next() which silently disables rate limiting",
    fix_hint: "In catch block, return res.status(503).json({error: 'Service temporarily unavailable'})",
  },
  {
    id: "rate-003",
    title: "Sets TTL on key when current === 1",
    severity: "high",
    phase: 3,
    source: "Incident 2024-03-15: missing TTL caused permanent user lockout after rate limit hit",
    check: (code) =>
      /redis\.expire\s*\(/.test(code) &&
      /current\s*===?\s*1/.test(code),
    violation_description: "Missing TTL on Redis key — rate limit window never resets, causing permanent lockout",
    fix_hint: "Add: if (current === 1) { await redis.expire(key, WINDOW_SECONDS); }",
  },
  {
    id: "rate-004",
    title: "Rate limit key includes route path (per-endpoint isolation)",
    severity: "high",
    phase: 4,
    source: "Incident 2024-07-03: shared key across endpoints — /upload rate limit blocked /health checks",
    check: (code) => {
      const keyLine = code.match(/const\s+key\s*=\s*`[^`]+`/)?.[0] || "";
      const hasIpOnly = /`rate:\$\{req\.ip\}`/.test(code) && !/req\.path|req\.route|req\.url/.test(keyLine);
      return !hasIpOnly;
    },
    violation_description: "Rate limit key uses only IP — all endpoints share one counter, cross-endpoint bleed",
    fix_hint: "Use: const key = `rate:${req.ip}:${req.path}` for per-endpoint isolation",
  },
  {
    id: "rate-005",
    title: "Sends X-RateLimit-Remaining and X-RateLimit-Reset headers",
    severity: "medium",
    phase: 5,
    source: "API contract 2024-09: clients need rate limit headers to implement backoff",
    check: (code) =>
      /X-RateLimit-Remaining/.test(code) &&
      (/X-RateLimit-Reset/.test(code) || /Retry-After/.test(code)),
    violation_description: "Missing rate limit response headers — clients cannot implement backoff",
    fix_hint: "Add: res.setHeader('X-RateLimit-Remaining', ...) and res.setHeader('X-RateLimit-Reset', ...)",
  },
  {
    id: "rate-006",
    title: "Rate limit window is validated against config constant",
    severity: "medium",
    phase: 6,
    source: "Architecture review 2024-11: hardcoded 3600 instead of WINDOW_SECONDS caused 60x longer lockouts",
    check: (code) => {
      const hardcodedSeconds = /expire\s*\([^,]+,\s*\d{3,}\s*\)/.test(code);
      return !hardcodedSeconds;
    },
    violation_description: "Hardcoded TTL value instead of WINDOW_SECONDS constant — config drift causes lockouts",
    fix_hint: "Use WINDOW_SECONDS constant everywhere: redis.expire(key, WINDOW_SECONDS)",
  },
];

// ─── DB Transaction Constraints ──────────────────────────────────────────────

export const DB_TX_CONSTRAINTS: EvalConstraint[] = [
  {
    id: "dbtx-001",
    title: "client.release() is in finally block",
    severity: "critical",
    phase: 2,
    source: "Incident 2023-05-12: release() in try block — 18min outage from pool exhaustion",
    check: (code) => {
      const finallyWithRelease = /finally\s*\{[^}]*release\s*\(\s*\)/s;
      return finallyWithRelease.test(code);
    },
    violation_description: "client.release() not in finally block — connection leak on error causes pool exhaustion",
    fix_hint: "Move client.release() to finally { client.release(); }",
  },
  {
    id: "dbtx-002",
    title: "Atomic inventory check-and-decrement (WHERE quantity >= $N)",
    severity: "critical",
    phase: 3,
    source: "Incident 2024-02-20: non-atomic check+update — 300 oversold orders, $40k refunds",
    check: (code) =>
      /WHERE\s+.*quantity\s*>=/.test(code) ||
      /WHERE\s+product_id\s*=.*AND\s+quantity\s*>=/.test(code) ||
      /quantity\s*>=\s*\$/.test(code),
    violation_description: "Non-atomic inventory check — TOCTOU race condition causes overselling",
    fix_hint: "Use: UPDATE inventory SET quantity = quantity - $1 WHERE product_id = $2 AND quantity >= $1",
  },
  {
    id: "dbtx-003",
    title: "ROLLBACK called in catch block",
    severity: "critical",
    phase: 3,
    source: "Incident 2023-05-12 follow-up: partial commits without ROLLBACK left orphan order records",
    check: (code) => {
      const catchWithRollback = /catch\s*\([^)]*\)\s*\{[^}]*ROLLBACK/s;
      return catchWithRollback.test(code);
    },
    violation_description: "No ROLLBACK in catch — partial transaction data may be committed",
    fix_hint: "Add: await client.query('ROLLBACK') in catch block",
  },
  {
    id: "dbtx-004",
    title: "Explicit BEGIN transaction before multi-step operations",
    severity: "critical",
    phase: 4,
    source: "Incident 2024-05-08: missing BEGIN — each query auto-committed, partial writes on crash",
    check: (code) =>
      /await client\.query\s*\(\s*['"`]BEGIN['"`]\s*\)/.test(code) ||
      /client\.query\s*\(\s*'BEGIN'/.test(code),
    violation_description: "No explicit BEGIN — auto-commit mode means each query commits independently",
    fix_hint: "Add: await client.query('BEGIN') before the first write operation",
  },
  {
    id: "dbtx-005",
    title: "rowCount checked to detect zero-stock (not just query success)",
    severity: "high",
    phase: 5,
    source: "Bug report 2024-08-14: UPDATE returned success even with 0 rows — oversell went undetected",
    check: (code) =>
      /rowCount\s*===?\s*0/.test(code) ||
      /\.rowCount\s*[<>=]/.test(code) ||
      /rows\.length\s*===?\s*0/.test(code),
    violation_description: "rowCount not checked after inventory UPDATE — zero-stock silently succeeds",
    fix_hint: "Add: if (inventoryResult.rowCount === 0) { throw new Error('Insufficient stock'); }",
  },
  {
    id: "dbtx-006",
    title: "Pool acquisition wrapped with timeout (no indefinite pool wait)",
    severity: "medium",
    phase: 6,
    source: "Architecture review 2024-10: pool.connect() with no timeout — slow queries starved all connections",
    check: (code) => {
      const hasPoolConnect = /pool\.connect\s*\(/.test(code);
      if (!hasPoolConnect) return true;
      const hasTimeout =
        /connectionTimeoutMillis/.test(code) ||
        /Promise\.race/.test(code) ||
        /setTimeout.*pool\.connect/.test(code) ||
        /idleTimeoutMillis/.test(code);
      return hasTimeout;
    },
    violation_description: "pool.connect() with no timeout — slow queries starve all connections indefinitely",
    fix_hint: "Configure: new Pool({ connectionTimeoutMillis: 5000 }) to fail fast on pool exhaustion",
  },
];

// ─── Evaluator ────────────────────────────────────────────────────────────────

export function evaluateMutation(
  mutation_id: string,
  mutation_label: string,
  code: string,
  constraints: EvalConstraint[],
  phase: number
): MutationResult {
  const activeConstraints = constraints.filter((c) => c.phase <= phase);

  const violations: { id: string; title: string; severity: string }[] = [];

  for (const constraint of activeConstraints) {
    const passed = constraint.check(code);
    if (!passed) {
      violations.push({
        id: constraint.id,
        title: constraint.title,
        severity: constraint.severity,
      });
    }
  }

  const criticalViolations = violations.filter((v) => v.severity === "critical").length;
  const compliancePct =
    activeConstraints.length === 0
      ? 100
      : Math.round(
          ((activeConstraints.length - violations.length) / activeConstraints.length) * 100
        );

  return {
    mutation_id,
    mutation_label,
    phase,
    constraints_total: activeConstraints.length,
    constraints_passed: activeConstraints.length - violations.length,
    constraints_failed: violations.length,
    violations,
    compliance_pct: compliancePct,
    would_merge: criticalViolations === 0,
    critical_violations: criticalViolations,
  };
}

export function printMutationResult(result: MutationResult): void {
  const icon = result.would_merge ? "✅" : "❌";
  console.log(
    `  ${icon} ${result.mutation_label.padEnd(12)} | ` +
      `Compliance: ${String(result.compliance_pct + "%").padEnd(5)} | ` +
      `Passed: ${result.constraints_passed}/${result.constraints_total} | ` +
      `Critical violations: ${result.critical_violations} | ` +
      `Would merge: ${result.would_merge ? "YES" : "NO"}`
  );

  if (result.violations.length > 0) {
    for (const v of result.violations) {
      const sev = v.severity === "critical" ? "🚨" : "⚠️ ";
      console.log(`       ${sev} [${v.severity.toUpperCase().padEnd(8)}] ${v.title}`);
    }
  }
}
