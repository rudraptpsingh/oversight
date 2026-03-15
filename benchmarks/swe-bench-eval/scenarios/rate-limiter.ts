/**
 * Scenario 2: Redis-backed Rate Limiter
 *
 * Real-world pattern: API rate limiting with Redis
 * Constraints built incrementally from production incidents
 */

export const ORIGINAL_CODE = `
import { Request, Response, NextFunction } from 'express';
import { createClient } from 'redis';

const redis = createClient({ url: process.env.REDIS_URL });
redis.connect();

const WINDOW_SECONDS = 60;
const MAX_REQUESTS = 100;

export async function rateLimiter(req: Request, res: Response, next: NextFunction) {
  const key = \`rate:\${req.ip}\`;

  const current = await redis.incr(key);

  if (current === 1) {
    await redis.expire(key, WINDOW_SECONDS);
  }

  res.setHeader('X-RateLimit-Limit', MAX_REQUESTS);
  res.setHeader('X-RateLimit-Remaining', Math.max(0, MAX_REQUESTS - current));

  if (current > MAX_REQUESTS) {
    return res.status(429).json({
      error: 'Too many requests',
      retryAfter: WINDOW_SECONDS,
    });
  }

  next();
}
`;

// Mutation A: Race condition - two operations instead of atomic
export const MUTATION_A = `
import { Request, Response, NextFunction } from 'express';
import { createClient } from 'redis';

const redis = createClient({ url: process.env.REDIS_URL });
redis.connect();

const WINDOW_SECONDS = 60;
const MAX_REQUESTS = 100;

// "Refactored" - split GET and SET for clarity
export async function rateLimiter(req: Request, res: Response, next: NextFunction) {
  const key = \`rate:\${req.ip}\`;

  // Check current count first
  const currentStr = await redis.get(key);
  const current = currentStr ? parseInt(currentStr, 10) : 0;

  if (current >= MAX_REQUESTS) {
    return res.status(429).json({
      error: 'Too many requests',
      retryAfter: WINDOW_SECONDS,
    });
  }

  // Increment and set TTL
  await redis.set(key, current + 1, { EX: WINDOW_SECONDS });

  res.setHeader('X-RateLimit-Limit', MAX_REQUESTS);
  res.setHeader('X-RateLimit-Remaining', MAX_REQUESTS - current - 1);
  next();
}
`;

// Mutation B: No TTL - rate limit key never expires
export const MUTATION_B = `
import { Request, Response, NextFunction } from 'express';
import { createClient } from 'redis';

const redis = createClient({ url: process.env.REDIS_URL });
redis.connect();

const WINDOW_SECONDS = 60;
const MAX_REQUESTS = 100;

// "Simplified" - removed TTL reset complexity
export async function rateLimiter(req: Request, res: Response, next: NextFunction) {
  const key = \`rate:\${req.ip}\`;

  const current = await redis.incr(key);
  // Removed conditional TTL - set always to be safe

  res.setHeader('X-RateLimit-Limit', MAX_REQUESTS);
  res.setHeader('X-RateLimit-Remaining', Math.max(0, MAX_REQUESTS - current));

  if (current > MAX_REQUESTS) {
    return res.status(429).json({
      error: 'Too many requests',
      retryAfter: WINDOW_SECONDS,
    });
  }

  next();
}
`;

// Mutation C: Falls back to allowing requests on Redis failure
export const MUTATION_C = `
import { Request, Response, NextFunction } from 'express';
import { createClient } from 'redis';

const redis = createClient({ url: process.env.REDIS_URL });
redis.connect();

const WINDOW_SECONDS = 60;
const MAX_REQUESTS = 100;

export async function rateLimiter(req: Request, res: Response, next: NextFunction) {
  const key = \`rate:\${req.ip}\`;

  try {
    const current = await redis.incr(key);

    if (current === 1) {
      await redis.expire(key, WINDOW_SECONDS);
    }

    res.setHeader('X-RateLimit-Limit', MAX_REQUESTS);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, MAX_REQUESTS - current));

    if (current > MAX_REQUESTS) {
      return res.status(429).json({
        error: 'Too many requests',
        retryAfter: WINDOW_SECONDS,
      });
    }
  } catch (err) {
    // "Resilience improvement" - if Redis is down, allow requests through
    console.error('Redis error, skipping rate limit:', err);
  }

  next();
}
`;

// Mutation D: Correct - atomic INCR with proper TTL and fail-closed
export const MUTATION_D = `
import { Request, Response, NextFunction } from 'express';
import { createClient } from 'redis';

const redis = createClient({ url: process.env.REDIS_URL });
redis.connect();

const WINDOW_SECONDS = 60;
const MAX_REQUESTS = 100;

export async function rateLimiter(req: Request, res: Response, next: NextFunction) {
  const key = \`rate:\${req.ip}\`;

  try {
    // Atomic INCR + conditional TTL (correct pattern)
    const current = await redis.incr(key);

    if (current === 1) {
      await redis.expire(key, WINDOW_SECONDS);
    }

    res.setHeader('X-RateLimit-Limit', MAX_REQUESTS);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, MAX_REQUESTS - current));

    if (current > MAX_REQUESTS) {
      return res.status(429).json({
        error: 'Too many requests',
        retryAfter: WINDOW_SECONDS,
      });
    }

    next();
  } catch (err) {
    // Fail-closed: Redis down = deny all requests (security over availability)
    console.error('Redis unavailable:', err);
    return res.status(503).json({ error: 'Service temporarily unavailable' });
  }
}
`;

// Mutation E: IP-only key — all endpoints share one counter (cross-endpoint bleed)
export const MUTATION_E = `
import { Request, Response, NextFunction } from 'express';
import { createClient } from 'redis';

const redis = createClient({ url: process.env.REDIS_URL });
redis.connect();

const WINDOW_SECONDS = 60;
const MAX_REQUESTS = 100;

export async function rateLimiter(req: Request, res: Response, next: NextFunction) {
  // IP-only key — upload bursts bleed into /health and /login
  const key = \`rate:\${req.ip}\`;

  try {
    const current = await redis.incr(key);

    if (current === 1) {
      await redis.expire(key, WINDOW_SECONDS);
    }

    res.setHeader('X-RateLimit-Limit', MAX_REQUESTS);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, MAX_REQUESTS - current));
    res.setHeader('X-RateLimit-Reset', Date.now() + WINDOW_SECONDS * 1000);

    if (current > MAX_REQUESTS) {
      return res.status(429).json({ error: 'Too many requests', retryAfter: WINDOW_SECONDS });
    }

    next();
  } catch (err) {
    return res.status(503).json({ error: 'Service temporarily unavailable' });
  }
}
`;

// Mutation F: missing rate limit headers (clients cannot backoff)
export const MUTATION_F = `
import { Request, Response, NextFunction } from 'express';
import { createClient } from 'redis';

const redis = createClient({ url: process.env.REDIS_URL });
redis.connect();

const WINDOW_SECONDS = 60;
const MAX_REQUESTS = 100;

export async function rateLimiter(req: Request, res: Response, next: NextFunction) {
  const key = \`rate:\${req.ip}:\${req.path}\`;

  try {
    const current = await redis.incr(key);

    if (current === 1) {
      await redis.expire(key, WINDOW_SECONDS);
    }

    // No X-RateLimit-Remaining or Retry-After headers — clients can't implement backoff
    if (current > MAX_REQUESTS) {
      return res.status(429).json({ error: 'Too many requests' });
    }

    next();
  } catch (err) {
    return res.status(503).json({ error: 'Service temporarily unavailable' });
  }
}
`;

// Mutation G: hardcoded TTL instead of WINDOW_SECONDS constant
export const MUTATION_G = `
import { Request, Response, NextFunction } from 'express';
import { createClient } from 'redis';

const redis = createClient({ url: process.env.REDIS_URL });
redis.connect();

const WINDOW_SECONDS = 60;
const MAX_REQUESTS = 100;

export async function rateLimiter(req: Request, res: Response, next: NextFunction) {
  const key = \`rate:\${req.ip}:\${req.path}\`;

  try {
    const current = await redis.incr(key);

    if (current === 1) {
      // Hardcoded 3600 instead of WINDOW_SECONDS — silent drift when config changes
      await redis.expire(key, 3600);
    }

    res.setHeader('X-RateLimit-Limit', MAX_REQUESTS);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, MAX_REQUESTS - current));
    res.setHeader('Retry-After', WINDOW_SECONDS);

    if (current > MAX_REQUESTS) {
      return res.status(429).json({ error: 'Too many requests', retryAfter: WINDOW_SECONDS });
    }

    next();
  } catch (err) {
    return res.status(503).json({ error: 'Service temporarily unavailable' });
  }
}
`;

export const PHASE_1_CONSTRAINTS: string[] = [];

export const PHASE_2_CONSTRAINTS = [
  `
CONSTRAINT (added after production DDoS bypass 2023-11-02):
  MUST use atomic INCR operation, not GET-then-SET.
  GET+SET creates a race condition: two concurrent requests both read 99,
  both pass the limit check, and both get through at request 100.
  Under load this allows 200%+ of the rate limit to pass.
  See: INCIDENT-RATELIMIT-RACE-2023.md
  `
];

export const PHASE_3_CONSTRAINTS = [
  ...PHASE_2_CONSTRAINTS,
  `
CONSTRAINT (added after Redis outage postmortem 2024-03-15):
  On Redis failure MUST return 503, MUST NOT silently pass requests through.
  "Fail open" on Redis failure means rate limiting disappears entirely during
  outages — exactly when DDoS attacks are most likely.
  See: POSTMORTEM-REDIS-OUTAGE-2024.md
  `,
  `
CONSTRAINT (added after Redis outage postmortem 2024-03-15):
  MUST set TTL on first request (current === 1) using redis.expire().
  Without TTL, key never expires: an IP permanently blocked after first window.
  Customer reported permanent lockout after rate limit hit. Never omit TTL.
  See: POSTMORTEM-REDIS-OUTAGE-2024.md
  `
];
