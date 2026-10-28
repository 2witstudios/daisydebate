import {
  consumeWindowsOrThrow,
  type RateLimiter,
  type RateRule,
} from '../../server/rate-limit';

/**
 * A username lookup proposes an actor for a member, so every lookup spends
 * the one `username-discovery:<actor>` bucket, whichever feature asks (a DM
 * request or a block): adding a feature never adds a probe budget.
 */
export const spendUsernameDiscovery = (
  limiter: RateLimiter,
  actorId: string,
  windows: readonly RateRule[],
) => consumeWindowsOrThrow(limiter, `username-discovery:${actorId}`, windows);
