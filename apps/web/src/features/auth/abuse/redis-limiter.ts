import { createHash } from 'node:crypto';
import { createAppError } from '@daisy/errors';
import type { MessagingSendReservation } from '@daisy/redis';
import type { AuthRateLimiter } from './rate-limit';

type ConsumingRedis = {
  readonly reserveMessagingSend?: (
    input: MessagingSendReservation,
  ) => Promise<{
    readonly allowed: boolean;
    readonly retryAfterSeconds: number;
  }>;
  readonly consumeRateLimit: (
    key: string,
    rule: { readonly windowSeconds: number; readonly max: number },
  ) => Promise<{
    readonly allowed: boolean;
    readonly retryAfterSeconds: number;
  }>;
};

/**
 * Shared limiter over the existing @daisy/redis client. Untrusted identifiers
 * (IPs, paths, recipients) are hashed into a valid key segment; a Redis outage
 * rejects so callers fail closed. There is deliberately no local fallback.
 */
export function createAuthRateLimiter(redis: ConsumingRedis): AuthRateLimiter {
  return {
    reserveMessagingSend: (input) => {
      if (!redis.reserveMessagingSend) throw createAppError('INFRASTRUCTURE');
      const hash = (value: string) =>
        createHash('sha3-256').update(value).digest('hex');
      return redis.reserveMessagingSend({
        ...input,
        actor: hash(input.actor),
        channel: hash(input.channel),
        request: hash(input.request),
      });
    },
    consume: (key, rule) =>
      redis.consumeRateLimit(
        createHash('sha3-256').update(key).digest('hex'),
        rule,
      ),
  };
}
