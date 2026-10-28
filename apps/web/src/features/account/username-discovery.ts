import {
  consumeWindowsOrThrow,
  type RateLimiter,
  type RateRule,
} from '../../server/rate-limit';

/**
 * Username discovery's own budget (DEC-251's per-account windows): how many
 * usernames one member may turn into actors, whatever feature asks.
 */
export const usernameDiscoveryWindows: readonly RateRule[] = Object.freeze([
  { max: 10, windowSeconds: 10 },
  { max: 30, windowSeconds: 60 },
  { max: 600, windowSeconds: 3_600 },
]);

/**
 * Spends one lookup from the member's `username-discovery:<actor>` budget.
 * Every feature that resolves a username (a DM or group request, a block, a
 * friendship or a challenge) spends it before the lookup, besides its own
 * command budget, so adding a feature never adds a probe budget.
 */
export const spendUsernameDiscovery = (limiter: RateLimiter, actorId: string) =>
  consumeWindowsOrThrow(
    limiter,
    `username-discovery:${actorId}`,
    usernameDiscoveryWindows,
  );
