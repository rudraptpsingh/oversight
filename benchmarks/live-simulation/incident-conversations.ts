/**
 * Real incident conversations for WhyCode live simulation.
 *
 * These are realistic post-mortem / code-review / audit conversations
 * that would actually happen in a real engineering team.
 *
 * The WhyCode AI capture engine will be called on each of these
 * conversations in real-time, and the extracted constraints will
 * be compared against the expected (hand-written) constraints.
 */

export interface IncidentConversation {
  id: string
  scenarioId: "auth" | "rate" | "dbtx"
  incidentDate: string
  incidentType: "incident" | "audit" | "pen-test" | "code-review" | "architecture-review" | "user-chat"
  title: string
  filePath: string
  expectedConstraintKeywords: string[]
  messages: Array<{ role: "user" | "assistant"; content: string }>
}

// ─── AUTH MIDDLEWARE INCIDENTS ────────────────────────────────────────────────

export const AUTH_CONVERSATIONS: IncidentConversation[] = [
  {
    id: "auth-incident-1",
    scenarioId: "auth",
    incidentDate: "2023-08-14",
    incidentType: "incident",
    title: "JWT decode() bypass — 12k accounts exposed",
    filePath: "auth-middleware.ts",
    expectedConstraintKeywords: ["jwt.verify", "jwt.decode", "signature"],
    messages: [
      {
        role: "user",
        content: `URGENT POST-MORTEM — SEC-INCIDENT-2023-08-14

Timeline:
- 03:42 UTC: Anomalous admin API calls detected by PagerDuty
- 03:51 UTC: On-call engineer identifies forged JWT tokens in logs
- 04:10 UTC: Root cause identified in requireAuth middleware
- 04:35 UTC: Fix deployed, affected accounts forced to re-auth

Root Cause:
The requireAuth middleware was calling jwt.decode() instead of jwt.verify(). The jwt.decode() function ONLY base64-decodes the token payload — it does NOT verify the signature. An attacker was able to forge an admin-level JWT with {"role": "admin"} in the payload, and our middleware accepted it as valid.

Affected code in auth-middleware.ts:
  const payload = jwt.decode(token)  // BUG: no signature check!
  req.user = payload

12,000 customer accounts were accessible with forged tokens. Data accessed includes emails, order history, and payment methods.

What constraint should we put in place?`
      },
      {
        role: "assistant",
        content: `This is a critical severity issue. The constraint is clear:

**ALWAYS use jwt.verify(token, JWT_SECRET) — NEVER use jwt.decode() for authentication.**

jwt.decode() is a utility function for extracting claims from tokens that you already know are valid (e.g., to read the user ID after verification in a downstream handler). It performs zero cryptographic verification. Any string in the correct base64 format will "decode" successfully.

jwt.verify() checks: (1) the signature matches the secret, (2) the token hasn't expired, (3) the issuer/audience match if configured.

The fix:
  const payload = jwt.verify(token, process.env.JWT_SECRET)  // CORRECT
  req.user = { id: payload.sub, role: payload.role }

This should be an inviolable constraint on this file. I'd also add an agent hint: "DO NOT replace jwt.verify() with jwt.decode() — jwt.decode() skips signature verification entirely and allows forged tokens."

Storing this as a WhyCode decision anchored to auth-middleware.ts with source: incident, conversationId: SEC-INCIDENT-2023-08-14.`
      },
      {
        role: "user",
        content: `Confirmed. This is now a hard constraint. No PR that changes jwt.verify() to jwt.decode() should ever merge. The cost of this incident was approximately $500k in security response, customer notification, and regulatory compliance work. This must never happen again.`
      },
      {
        role: "assistant",
        content: `Recording constraint with definitive confidence and critical severity. The decision record will include:
- doNotChange: ["jwt.verify"]
- reviewTriggers: ["jwt.decode", "token validation"]
- Constraint: MUST use jwt.verify() not jwt.decode() — severity: must
- LinkedIssue: SEC-INCIDENT-2023-08-14
- Incident cost: $500k`
      }
    ]
  },
  {
    id: "auth-incident-2",
    scenarioId: "auth",
    incidentDate: "2024-01-20",
    incidentType: "audit",
    title: "Security audit Q1 2024 — tokens in query params + next() on failure",
    filePath: "auth-middleware.ts",
    expectedConstraintKeywords: ["query", "Authorization header", "next()", "401", "catch"],
    messages: [
      {
        role: "user",
        content: `Security Audit Q1 2024 — Findings for auth-middleware.ts

FINDING 1 — HIGH SEVERITY:
Some API endpoints accept JWTs via ?token= query parameter.
Reproduction: GET /api/orders?token=eyJhbGci...

Why this is critical:
- nginx access logs record full URLs including query params
- CDN (Cloudflare) logs every URL at the edge
- Browser history stores query params
- Referrer headers leak query params to third-party analytics

A token in a URL is a persistent credential stored in 5+ insecure locations simultaneously. Tokens from 3 weeks ago were found in our Datadog logs.

FINDING 2 — CRITICAL SEVERITY:
In the catch block of requireAuth, there is a code path that calls next() instead of returning 401:

  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' })
    }
    next()  // BUG: falls through to unprotected route handler!
  }

This was live in production for 11 days before the audit caught it. During those 11 days, any request to a protected route with a malformed token would silently proceed as unauthenticated.

What constraints do we need?`
      },
      {
        role: "assistant",
        content: `Two hard constraints from these findings:

**Constraint 1 — Token Source:**
ONLY accept tokens from the Authorization: Bearer header. Never from req.query, req.body, or cookies.
- Severity: must
- Rationale: URLs containing tokens are logged to nginx, CDN, browser history, referrer headers. A query-param token is a credential stored in 5+ insecure locations.

**Constraint 2 — Catch Block Behavior:**
The catch block MUST return 401. It MUST NOT call next() under any circumstances.
- Severity: must
- Rationale: next() in a catch block bypasses authentication entirely. Every throw/exception path in the auth middleware must terminate with res.status(401).json({error: '...'}).

The correct pattern:
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' })
    // NEVER: next()
  }

Both constraints should be anchored to auth-middleware.ts. The 11-day exposure from Finding 2 represents serious regulatory risk given GDPR requirements.`
      },
      {
        role: "user",
        content: `Agreed on both. For Finding 2 specifically — the PR that introduced that next() call had 3 reviewers and none of them caught it. This is exactly why we need WhyCode: a human reviewer can miss it, but an automated constraint check would have flagged "next() in catch block of auth middleware" immediately. Record both constraints with source: audit, AUDIT-2024-Q1.`
      }
    ]
  },
  {
    id: "auth-incident-3",
    scenarioId: "auth",
    incidentDate: "2024-06-15",
    incidentType: "pen-test",
    title: "Pen test — alg:none bypass + ignoreExpiration + payload spread",
    filePath: "auth-middleware.ts",
    expectedConstraintKeywords: ["algorithms", "alg:none", "ignoreExpiration", "payload", "req.user"],
    messages: [
      {
        role: "user",
        content: `Pen Test Report — June 2024 — auth-middleware.ts

CRITICAL: alg:none Algorithm Confusion Attack
Our jwt.verify() call doesn't specify the algorithms option:
  jwt.verify(token, JWT_SECRET)  // vulnerable to alg:none

By sending a JWT with header {"alg": "none"}, the library accepts unsigned tokens. The attacker POC:
  const forgedToken = base64url({ alg: 'none', typ: 'JWT' }) + '.' + base64url({ sub: 'admin-1', role: 'admin' }) + '.'
  // Empty signature accepted when alg:none is not explicitly rejected

Fix: jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] })

HIGH: ignoreExpiration:true in one code path
Found in a "remember me" flow: jwt.verify(token, JWT_SECRET, { ignoreExpiration: true })
A deleted user's token from 18 months ago was still accepted. Ex-employee credentials are still valid.

MEDIUM: Raw payload spread into req.user
  const payload = jwt.verify(token, JWT_SECRET)
  req.user = { ...payload }  // BUG: spreads ALL JWT claims

An attacker who can influence JWT contents (e.g., via user metadata) can inject claims like isAdmin, role, permissions that get spread into req.user and then checked by downstream authorization code.`
      },
      {
        role: "assistant",
        content: `Three constraints from this pen test:

**Constraint 1 — Algorithm Pinning (alg:none bypass):**
jwt.verify() MUST specify { algorithms: ['HS256'] } (or the appropriate algorithm).
- Severity: critical
- Without this option, the library may accept unsigned tokens with alg:none header
- Fix: jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] })

**Constraint 2 — No ignoreExpiration:**
NEVER set ignoreExpiration: true in jwt.verify options.
- Severity: high
- jwt.verify() checks expiry by default — this is the correct behavior
- ignoreExpiration: true means deleted/disabled accounts retain indefinite access
- The "remember me" use case should use long-lived refresh tokens, not disable expiry checking

**Constraint 3 — Explicit req.user mapping (no raw spread):**
NEVER spread the raw JWT payload into req.user.
- Severity: medium
- { ...payload } or Object.assign(req.user, payload) passes through ALL claims
- An attacker with any control over JWT contents can inject isAdmin, permissions, role, etc.
- MUST use explicit field mapping: req.user = { id: payload.sub, role: payload.role, sessionId: payload.sid }

These three constraints together with the previous two give us complete coverage of the JWT attack surface.`
      },
      {
        role: "user",
        content: `All three confirmed. The alg:none finding has a CVSS score of 9.8 — it should be a blocker on any PR touching auth-middleware.ts. Record all three with source: incident, pen-test-2024-06. The ignoreExpiration one should have a doNotChange entry: "ignoreExpiration: true must never appear in this file."`
      }
    ]
  }
]

// ─── RATE LIMITER INCIDENTS ───────────────────────────────────────────────────

export const RATE_LIMITER_CONVERSATIONS: IncidentConversation[] = [
  {
    id: "rate-incident-1",
    scenarioId: "rate",
    incidentDate: "2023-11-02",
    incidentType: "incident",
    title: "DDoS bypass via GET+SET race condition — 40k req/s",
    filePath: "rate-limiter.ts",
    expectedConstraintKeywords: ["incr", "atomic", "GET", "SET", "race condition"],
    messages: [
      {
        role: "user",
        content: `POST-MORTEM: Rate Limiter Race Condition — 2023-11-02

During a DDoS attack, our rate limiter completely failed. We saw 40,000 requests/second against an endpoint limited to 100 req/s. The rate limiter code:

  const current = await redis.get(key)
  const count = current ? parseInt(current) : 0
  if (count >= limit) {
    return res.status(429).json({ error: 'Too many requests' })
  }
  await redis.set(key, count + 1, 'EX', WINDOW_SECONDS)

The bug: GET and SET are separate operations. Under concurrent load, 100 simultaneous requests all GET the same value (say, 50), all compute count + 1 = 51, all check 51 < 100, and all SET key to 51. The counter never actually increments correctly.

The correct solution is Redis INCR which is atomic:
  const current = await redis.incr(key)
  if (current === 1) { await redis.expire(key, WINDOW_SECONDS) }
  if (current > limit) { return res.status(429) }

What constraint should we record?`
      },
      {
        role: "assistant",
        content: `The constraint is clear and critical:

**MUST use redis.incr() for atomic rate counter increment — NEVER use redis.get() + redis.set().**

The GET+SET pattern has an inherent TOCTOU (time-of-check-time-of-use) race condition. In any concurrent system — which all web servers are — you cannot safely read-modify-write a counter across two separate commands. Redis provides INCR precisely to solve this: it increments and returns the new value atomically in a single command.

Constraint:
- description: "MUST use redis.incr(key) for rate counter — NEVER GET+SET"
- severity: must
- rationale: GET+SET has TOCTOU race condition; concurrent requests bypass rate limit entirely

The correct pattern to store as doNotChange: the entire INCR block pattern.
The reviewTrigger should be: ["redis.get", "redis.set", "rate limit"] — any change that touches GET+SET in context of rate limiting needs manual review.

Anchored to rate-limiter.ts. Source: incident 2023-11-02.`
      },
      {
        role: "user",
        content: `Confirmed. Also note that the TTL must be set ONLY when current === 1 (i.e., first request in the window), not on every request. If you set TTL on every request, you extend the window on each hit and the rate limit never resets. Record this as part of the constraint.`
      },
      {
        role: "assistant",
        content: `Good catch — that's a second constraint from the same incident:

**MUST set redis.expire(key, WINDOW_SECONDS) ONLY when current === 1.**

Rationale: Setting TTL on every INCR resets the window on each request. With a 60-second window, if a user makes 1 request per second, their window never expires and they get permanently rate-limited after hitting the limit once. The TTL must only be set on the FIRST increment (current === 1) to establish the window start.

Pattern:
  const current = await redis.incr(key)
  if (current === 1) {
    await redis.expire(key, WINDOW_SECONDS)  // only on first request
  }`
      }
    ]
  },
  {
    id: "rate-incident-2",
    scenarioId: "rate",
    incidentDate: "2024-03-15",
    incidentType: "incident",
    title: "Redis outage: fail-open + permanent lockout from missing TTL",
    filePath: "rate-limiter.ts",
    expectedConstraintKeywords: ["503", "fail-closed", "next()", "Redis failure", "catch"],
    messages: [
      {
        role: "user",
        content: `POST-MORTEM: Redis Outage Incident — 2024-03-15

During a Redis cluster failover (planned maintenance, 4-minute window), our rate limiter entered fail-open mode. The current error handling:

  try {
    const current = await redis.incr(key)
    // ... rate limit logic
  } catch (err) {
    console.error('Redis error:', err)
    next()  // BUG: silently allows all traffic through
  }

During the 4-minute Redis downtime, 100% of traffic flowed through with no rate limiting. This caused $80,000 in compute costs from an automated scraper that was previously being rate-limited.

Additionally, we discovered that some users who hit the rate limit during the outage recovery had keys created WITHOUT TTL (the expire() call also failed silently), resulting in permanent lockout. Users were submitting support tickets 3 weeks later still being rate-limited.

Two constraints needed: (1) fail-closed behavior during Redis errors, (2) validate TTL was actually set.`
      },
      {
        role: "assistant",
        content: `Two critical constraints from this incident:

**Constraint 1 — Fail Closed on Redis Error:**
MUST return 503 Service Unavailable when Redis throws. MUST NOT call next() in the catch block.
- Severity: critical
- Rationale: Calling next() on Redis failure disables rate limiting silently. The rate limiter doesn't know if it's a temporary error or permanent failure — defaulting to "allow all" creates unlimited cost exposure.
- Pattern:
  } catch (err) {
    return res.status(503).json({ error: 'Service temporarily unavailable' })
    // NEVER: next() — this would disable rate limiting
  }

**Constraint 2 — Key Must Include Per-Endpoint Isolation:**
The constraint about TTL only on current === 1 is already captured. But the deeper issue is that if the expire() call fails after incr() succeeds, the key is immortal.

For the fail-closed constraint: doNotChange should include the 503 return in catch. reviewTriggers: ["catch", "Redis error", "next()"].

Both anchored to rate-limiter.ts, source: incident 2024-03-15, RATE-INCIDENT-2024-03.`
      },
      {
        role: "user",
        content: `Correct on fail-closed. For the permanent lockout issue — the fix was to ensure redis.expire() is called atomically with the incr. We moved to a Lua script for the whole operation. The constraint is: Redis rate limiter MUST be fail-closed, not fail-open. "When in doubt, deny" is the security-correct default for a rate limiter protecting compute resources.`
      }
    ]
  },
  {
    id: "rate-incident-3",
    scenarioId: "rate",
    incidentDate: "2024-07-03",
    incidentType: "incident",
    title: "IP-only key caused /health monitoring blackout",
    filePath: "rate-limiter.ts",
    expectedConstraintKeywords: ["req.path", "per-endpoint", "key", "route", "X-RateLimit"],
    messages: [
      {
        role: "user",
        content: `INCIDENT: Monitoring Blackout — 2024-07-03

Our rate limit key was:
  const key = \`rate:\${req.ip}\`

This is a global key per IP across ALL endpoints. A burst of file uploads from an office IP (10 concurrent uploads, each 5MB) triggered the rate limit. The same IP then had its /health check requests rate-limited — which knocked it out of our monitoring system.

PagerDuty falsely reported 40 servers as "down" because their /health endpoints were returning 429s, not because the servers were actually down. On-call engineers spent 2 hours investigating a phantom outage.

Additionally, we got a complaint from a customer integration team: they were hitting the rate limit on /api/export but had NO idea how close they were to the limit. The response had no X-RateLimit-Remaining or X-RateLimit-Reset headers. Their client was retrying aggressively on 429s without any backoff, which made our rate-limiting worse — each retry counted as a new request, multiplying the load.

Two constraints needed.`
      },
      {
        role: "assistant",
        content: `Two constraints from this incident:

**Constraint 1 — Per-Endpoint Rate Limit Key:**
The rate limit key MUST include the route/path for per-endpoint isolation.
- Severity: high
- Current: \`rate:\${req.ip}\` (all endpoints share one counter)
- Required: \`rate:\${req.ip}:\${req.path}\` (each endpoint has its own counter)
- Rationale: A shared key means uploading files exhausts the /health check budget. Endpoints with different traffic patterns must have isolated counters.

**Constraint 2 — Rate Limit Response Headers:**
MUST include X-RateLimit-Remaining and X-RateLimit-Reset (or Retry-After) in all responses.
- Severity: medium
- Rationale: Without these headers, well-behaved clients cannot implement backoff. They retry immediately on 429, which multiplies load. RFC 6585 specifies Retry-After; many client libraries respect it for automatic backoff.
- Pattern:
  res.setHeader('X-RateLimit-Remaining', Math.max(0, limit - current))
  res.setHeader('X-RateLimit-Reset', Math.floor(Date.now() / 1000) + WINDOW_SECONDS)

Also: WINDOW_SECONDS must be a named constant — hardcoding 3600 instead of WINDOW_SECONDS is a config drift risk. This deserves its own constraint from the architecture review.

Anchored to rate-limiter.ts, source: incident 2024-07-03.`
      }
    ]
  }
]

// ─── DB TRANSACTION INCIDENTS ─────────────────────────────────────────────────

export const DB_TX_CONVERSATIONS: IncidentConversation[] = [
  {
    id: "dbtx-incident-1",
    scenarioId: "dbtx",
    incidentDate: "2023-05-12",
    incidentType: "incident",
    title: "Connection pool exhaustion — release() not in finally — 18min outage",
    filePath: "db-transaction.ts",
    expectedConstraintKeywords: ["finally", "release", "ROLLBACK", "catch"],
    messages: [
      {
        role: "user",
        content: `POST-MORTEM: Database Outage 2023-05-12 — 18 Minutes

Starting at 14:23 UTC, all database operations began timing out. No new connections could be acquired from the pool. Root cause: pg Pool connection exhaustion.

The problematic code in processOrder():
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // ... business logic that can throw
    await client.query('COMMIT')
    await client.release()  // BUG: only called in happy path!
  } catch (err) {
    await client.query('ROLLBACK')
    // release() NEVER CALLED on error path
    throw err
  }

Every failed transaction (payment declined, inventory error, validation failure) leaked a connection. Under normal load this was invisible. During a promotion event with higher error rates (10% of orders failing due to a payment gateway timeout), connections drained in 4 minutes.

Pool size: 20 connections. All 20 were leaked. The fix:
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // ...
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()  // ALWAYS runs, even on throw
  }

What constraint?`
      },
      {
        role: "assistant",
        content: `This is a critical constraint with clear language:

**client.release() MUST be in the finally block — NEVER in try or catch only.**

The finally block in JavaScript/TypeScript executes regardless of whether the try block succeeded, threw an error, or the catch block threw. It is the ONLY guaranteed execution path for cleanup code.

Putting release() in try means: on any error/throw, the connection is never returned to the pool.
Putting release() in catch means: on success (no catch triggered), the connection is returned in try but any catch-path errors that don't trigger catch (e.g., the catch itself throws) leak.

The correct pattern:
  } finally {
    client.release()
  }

Additionally, ROLLBACK must be called in the catch block before releasing. The constraint should be:
1. MUST: client.release() in finally block
2. MUST: ROLLBACK called in catch block

These are linked — you can't correctly handle both without separating catch (ROLLBACK) from finally (release).

doNotChange: ["finally { client.release() }"]
reviewTriggers: ["pool.connect", "client.release", "connection"]
Anchored to db-transaction.ts, source: incident 2023-05-12.`
      },
      {
        role: "user",
        content: `Confirmed. The ROLLBACK constraint is important too — without ROLLBACK before release(), partial transaction data can be committed. We had a separate bug where the ROLLBACK was missing and orders were created without inventory being decremented. Make sure both constraints are captured: (1) release in finally, (2) ROLLBACK in catch.`
      }
    ]
  },
  {
    id: "dbtx-incident-2",
    scenarioId: "dbtx",
    incidentDate: "2024-02-20",
    incidentType: "incident",
    title: "Non-atomic inventory check — 300 oversold orders — $40k refunds",
    filePath: "db-transaction.ts",
    expectedConstraintKeywords: ["atomic", "WHERE quantity", "UPDATE", "inventory", "TOCTOU", "BEGIN"],
    messages: [
      {
        role: "user",
        content: `CRITICAL INCIDENT: Inventory Oversell — 2024-02-20

Black Friday flash sale. 300 orders were placed for an item with only 50 units in stock. The code:

  // Check inventory
  const checkResult = await client.query(
    'SELECT quantity FROM inventory WHERE product_id = $1',
    [productId]
  )
  const available = checkResult.rows[0].quantity

  if (available < quantity) {
    throw new Error('Insufficient stock')
  }

  // Decrement inventory (separate query)
  await client.query(
    'UPDATE inventory SET quantity = quantity - $1 WHERE product_id = $2',
    [quantity, productId]
  )

The problem: SELECT and UPDATE are separate queries. Between the SELECT (which returned quantity=50) and the UPDATE, 299 other requests also read quantity=50, also passed the check, and all decremented. Classic TOCTOU race.

Additionally: this entire operation wasn't wrapped in BEGIN/COMMIT. Each query auto-committed independently.

The atomic solution:
  const result = await client.query(
    'UPDATE inventory SET quantity = quantity - $1
     WHERE product_id = $2 AND quantity >= $1
     RETURNING quantity',
    [quantity, productId]
  )
  if (result.rowCount === 0) {
    throw new Error('Insufficient stock')
  }

The WHERE quantity >= $1 makes the check and decrement atomic. If stock is insufficient, 0 rows updated.`
      },
      {
        role: "assistant",
        content: `Three constraints from this incident:

**Constraint 1 — Atomic Inventory Update:**
MUST use atomic UPDATE with WHERE quantity >= $N. NEVER use separate SELECT then UPDATE.
- Severity: critical
- Rationale: SELECT + UPDATE is a TOCTOU race condition. Under any concurrent load, multiple transactions pass the stock check before any of them decrements. The only correct solution is a single UPDATE statement that checks and decrements atomically.
- Pattern: UPDATE inventory SET quantity = quantity - $1 WHERE product_id = $2 AND quantity >= $1

**Constraint 2 — Check rowCount After Inventory UPDATE:**
MUST check result.rowCount === 0 to detect out-of-stock condition.
- Severity: high
- Rationale: The atomic UPDATE returns 0 rows when stock is insufficient. If you don't check rowCount, a failed inventory decrement (0 rows) looks identical to a successful one. The order proceeds, inventory goes negative.
- Pattern: if (result.rowCount === 0) { throw new Error('Insufficient stock') }

**Constraint 3 — Explicit BEGIN Before Multi-Step Operations:**
MUST call await client.query('BEGIN') before the first write.
- Severity: critical
- Rationale: Without BEGIN, each query auto-commits. A failure after order creation but before inventory decrement creates a committed order with no stock reduction — ghost orders with no inventory consumed.

This $40,000 incident ($133/order in refunds, customer service, and platform fees) was entirely preventable with these three constraints.`
      },
      {
        role: "user",
        content: `All confirmed. The rowCount check is subtle but critical — I've seen engineers assume that a successful query means rows were affected. PostgreSQL returns success (no error) for an UPDATE that matched 0 rows. You have to check rowCount explicitly. This should be in the agentHints: "DO NOT assume a successful UPDATE means rows were changed — always check result.rowCount"`
      }
    ]
  },
  {
    id: "dbtx-incident-3",
    scenarioId: "dbtx",
    incidentDate: "2024-10-01",
    incidentType: "architecture-review",
    title: "Architecture review — no connectionTimeoutMillis — OOM risk",
    filePath: "db-transaction.ts",
    expectedConstraintKeywords: ["connectionTimeoutMillis", "timeout", "pool", "Pool"],
    messages: [
      {
        role: "user",
        content: `Architecture Review — DB Transaction Pool Configuration

Reviewing the Pool configuration in db-transaction.ts:

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 20,
  })

Issue: no connectionTimeoutMillis is set. This means pool.connect() will wait indefinitely for a connection to become available.

Scenario: A slow query (e.g., a missing index on a large table) holds connections for 30+ seconds. New requests queue behind it in pool.connect() — also waiting. Queue grows. Memory usage grows. Eventually Node.js heap OOM crash.

Observed in staging: a poorly-indexed query during load testing held the pool for 45 seconds. The API server consumed 2.4GB of RAM from queued requests and crashed. With connectionTimeoutMillis: 5000, requests fail fast with a clear error instead of queuing indefinitely.

The fix:
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 20,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
  })

Should this be a constraint?`
      },
      {
        role: "assistant",
        content: `Yes — this is a well-justified architectural constraint:

**Pool MUST be configured with connectionTimeoutMillis.**
- Severity: medium (architectural correctness, not immediate safety)
- Rationale: Without a connection timeout, pool.connect() queues indefinitely. Under load, this creates unbounded memory growth from pending requests, leading to OOM crashes. A 5-second timeout converts a hanging server into a fast-failing one — far better for both operators and clients.

Recommended configuration:
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 20,
    connectionTimeoutMillis: 5000,  // fail fast if pool exhausted
    idleTimeoutMillis: 30000,        // release idle connections
  })

Agent hint: "DO NOT create a Pool without connectionTimeoutMillis — unlimited wait causes OOM under load"
reviewTriggers: ["new Pool(", "pool.connect", "connectionTimeoutMillis"]

This is a "defense in depth" constraint — the pool exhaustion from the 2023-05-12 incident (release() not in finally) would have been much worse without a timeout. Even with correct release() patterns, slow queries or external failures can exhaust the pool temporarily.

Anchored to db-transaction.ts, source: architecture-review 2024-10.`
      },
      {
        role: "user",
        content: `Perfect. Record this with confidence: definitive. We've been bitten by this three times now in various services. It's a standard pattern for all database pools in this codebase. All new Pool() calls should include connectionTimeoutMillis.`
      }
    ]
  }
]

export const ALL_CONVERSATIONS = [
  ...AUTH_CONVERSATIONS,
  ...RATE_LIMITER_CONVERSATIONS,
  ...DB_TX_CONVERSATIONS,
]
