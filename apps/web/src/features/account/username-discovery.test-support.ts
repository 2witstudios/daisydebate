import { fixedClock, sequentialId } from '@daisy/clock';
import type { App } from '../../server/app';
import type { RateRule } from '../../server/rate-limit';
import { betaMessagingPolicy } from '../messaging/beta-policy';
import { createMessagingUnitApp } from '../messaging/messaging-app.test-support';
import { signedMessagingAuth } from '../messaging/signed-messaging.test-support';
import { usernameDiscoveryWindows } from './username-discovery';

/** The `[key, rule]` spends one discovery makes for `actorId`. */
export const discoverySpends = (actorId: string) =>
  usernameDiscoveryWindows.map((rule) => [
    `username-discovery:${actorId}:${rule.windowSeconds}`,
    rule,
  ]);

/**
 * A member's signed session over a unit app whose limiter records every
 * `[key, rule]` it is asked to spend, for composition tests of username
 * routes. `compose` receives the app with `database` overrides applied.
 */
export async function openRecordedMember<Routes>(
  actorId: string,
  email: string,
  compose: (app: App) => Routes,
  options: {
    readonly database?: Partial<App['database']>;
    readonly messagingPolicy?: App['messagingPolicy'];
  } = {},
) {
  const { auth, cookie } = await signedMessagingAuth(actorId, email);
  const app = createMessagingUnitApp({
    clock: fixedClock('2026-10-28T03:00:00.000Z'),
    ids: sequentialId('recorded-member'),
    messagingPolicy: options.messagingPolicy ?? betaMessagingPolicy,
  });
  const spent: [string, RateRule][] = [];
  const routes = compose({
    ...app,
    auth: () => auth,
    limiter: {
      consume: async (key, rule) => {
        spent.push([key, rule]);
        return { allowed: true, retryAfterSeconds: 0 };
      },
    },
    database: { ...app.database, ...options.database },
  });
  const origin = auth.config.PUBLIC_APP_URL;
  return {
    routes,
    spent,
    post: (path: string, body: unknown) =>
      new Request(`${origin}${path}`, {
        method: 'POST',
        headers: { cookie, origin, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    close: () => app.close(),
  };
}
