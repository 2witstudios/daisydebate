import type { App } from '../../server/app';
import {
  consumeWindowsOrThrow,
  type RateLimiter,
  type RateRule,
} from '../../server/rate-limit';

/**
 * Username discovery's own budget: DEC-251's per-account windows, fixed and
 * not deployment-tunable. `MESSAGING_POLICY` and `CONTACTS_POLICY` tighten
 * only their own command budgets, never how many usernames a member may
 * resolve.
 */
export const usernameDiscoveryWindows: readonly RateRule[] = Object.freeze([
  { max: 10, windowSeconds: 10 },
  { max: 30, windowSeconds: 60 },
  { max: 600, windowSeconds: 3_600 },
]);

/**
 * The most usernames one request may resolve: the smallest window's count,
 * so a batch that discovery could never fit is refused before any spend.
 */
export const usernameDiscoveryBatch = Math.min(
  ...usernameDiscoveryWindows.map((rule) => rule.max),
);

/** Resolves one username for a member, or null when no member holds it. */
export type DiscoverActor = (
  actorId: string,
  username: string,
) => Promise<string | null>;

/**
 * The one username port: every lookup first spends one unit of the member's
 * `username-discovery:<actor>` budget, so a feature (a DM or group request,
 * a block, a friendship or a challenge) can neither skip it nor add a probe
 * budget, and a batch of names spends once per name.
 */
export const discoverActor =
  (
    limiter: RateLimiter,
    lookup: (username: string) => Promise<string | null>,
  ): DiscoverActor =>
  async (actorId, username) => {
    await consumeWindowsOrThrow(
      limiter,
      `username-discovery:${actorId}`,
      usernameDiscoveryWindows,
    );
    return lookup(username);
  };

/** The app's username port over its limiter and actor directory. */
export const appDiscoverActor = (app: Pick<App, 'limiter' | 'database'>) =>
  discoverActor(app.limiter, (username) =>
    app.database.lookupHumanActorByUsername(username),
  );
