import { createHash } from 'node:crypto';
import { createAppError } from '@daisy/errors';

/** Fixed-window allowance one key may consume. */
export type RateRule = {
  readonly windowSeconds: number;
  readonly max: number;
};

/** Atomic multi-instance limiter contract, backed by @daisy/redis. */
export type RateLimiter = {
  readonly consume: (
    key: string,
    rule: RateRule,
  ) => Promise<{
    readonly allowed: boolean;
    readonly retryAfterSeconds: number;
  }>;
};

type ConsumingRedis = {
  readonly consumeRateLimit: RateLimiter['consume'];
};

/**
 * The application's one limiter over the existing @daisy/redis client,
 * composed once in `server/app.ts` for every feature that throttles. Untrusted
 * identifiers (IPs, paths, recipients) are hashed into a valid key segment;
 * a Redis outage rejects so callers fail closed. There is deliberately no
 * local fallback.
 */
export function createRateLimiter(redis: ConsumingRedis): RateLimiter {
  return {
    consume: (key, rule) =>
      redis.consumeRateLimit(
        createHash('sha3-256').update(key).digest('hex'),
        rule,
      ),
  };
}

/**
 * The limiter is an injected boundary: a decision without a boolean verdict
 * is an outage, never an implicit allow and never a TypeError.
 */
export const readLimiterDecision = (decision: unknown) => {
  if (typeof decision !== 'object' || decision === null)
    throw new TypeError('Malformed limiter decision');
  const allowed: unknown = Reflect.get(decision, 'allowed');
  if (typeof allowed !== 'boolean')
    throw new TypeError('Malformed limiter decision');
  const retryAfterSeconds: unknown = Reflect.get(decision, 'retryAfterSeconds');
  return { allowed, retryAfterSeconds };
};

/**
 * The single-bucket atomic-limit gate a route runs before its durable work:
 * consume one decision, fail closed with `INFRASTRUCTURE` on outage or a
 * malformed answer, and refuse with `RATE_LIMIT` when denied. Callers with
 * more than one bucket (auth's magic-link gate) use `readLimiterDecision`.
 */
export async function consumeOrThrow(
  limiter: RateLimiter,
  key: string,
  rule: RateRule,
): Promise<void> {
  let decision: { readonly allowed: boolean };
  try {
    decision = readLimiterDecision(await limiter.consume(key, rule));
  } catch (error) {
    throw createAppError('INFRASTRUCTURE', undefined, error);
  }
  if (!decision.allowed) throw createAppError('RATE_LIMIT');
}

/**
 * One multi-window rule: every window is its own fixed-window bucket under
 * `key`, and the first exhausted window refuses. Windows have distinct
 * lengths, so their keys never collide.
 */
export async function consumeWindowsOrThrow(
  limiter: RateLimiter,
  key: string,
  windows: readonly RateRule[],
): Promise<void> {
  for (const rule of windows)
    await consumeOrThrow(limiter, `${key}:${rule.windowSeconds}`, rule);
}
