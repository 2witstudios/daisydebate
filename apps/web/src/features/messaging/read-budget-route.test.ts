import { assert, setupRitewayBun, test } from 'riteway/bun';
import { fixedClock, sequentialId } from '@daisy/clock';
import { betaMessagingPolicy } from './beta-policy';
import { composeMessagingRoutes } from './composition';
import { createMessagingUnitApp } from './messaging-app.test-support';
import { signedMessagingAuth } from './signed-messaging.test-support';

setupRitewayBun();

test('the inbox and a conversation’s entry spend the one DEC-251 read budget', async () => {
  const actorId = 'a'.repeat(24);
  const { auth, cookie } = await signedMessagingAuth(
    actorId,
    'read-budget@daisy.example.com',
  );
  const spent: unknown[] = [];
  const app = createMessagingUnitApp({
    clock: fixedClock('2026-10-27T12:00:00.000Z'),
    ids: sequentialId('read-budget'),
    messagingPolicy: betaMessagingPolicy,
  });
  // A spent budget: the unreachable database must never be asked.
  const routes = composeMessagingRoutes({
    ...app,
    auth: () => ({
      ...auth,
      limiter: {
        consume: async (key, rule) => {
          spent.push([key, rule]);
          return { allowed: false, retryAfterSeconds: 60 };
        },
      },
    }),
  });
  const origin = auth.config.PUBLIC_APP_URL;
  const get = (path: string) =>
    new Request(`${origin}${path}`, { headers: { cookie } });
  try {
    const statuses = [
      (await routes.inbox(get('/api/messaging/inbox'))).status,
      (
        await routes.channelEntry(
          get(`/api/messaging/channels/${'c'.repeat(24)}/entry`),
          'c'.repeat(24),
        )
      ).status,
    ];
    assert({
      given: 'a member whose 120-per-minute read budget is spent',
      should:
        'refuse the inbox and the entry as rate limited, spending the shared read bucket before any read',
      actual: [statuses, spent],
      expected: [
        [429, 429],
        [
          [`messaging:read:${actorId}:60`, { max: 120, windowSeconds: 60 }],
          [`messaging:read:${actorId}:60`, { max: 120, windowSeconds: 60 }],
        ],
      ],
    });
  } finally {
    await app.close();
  }
});

test('a spent typing budget never refuses content reads', async () => {
  const actorId = 'a'.repeat(24);
  const { auth, cookie } = await signedMessagingAuth(
    actorId,
    'typing-budget@daisy.example.com',
  );
  const app = createMessagingUnitApp({
    clock: fixedClock('2026-10-27T12:00:00.000Z'),
    ids: sequentialId('typing-budget'),
    messagingPolicy: betaMessagingPolicy,
  });
  // Only the typing bucket is spent; content reads may proceed (to the
  // unreachable database, which answers 503 rather than 429).
  const routes = composeMessagingRoutes({
    ...app,
    auth: () => ({
      ...auth,
      limiter: {
        consume: async (key) => ({
          allowed: !key.startsWith('messaging:typing:'),
          retryAfterSeconds: 60,
        }),
      },
    }),
  });
  const origin = auth.config.PUBLIC_APP_URL;
  const channelId = 'c'.repeat(24);
  try {
    const typing = await routes.typing(
      new Request(`${origin}/api/messaging/channels/${channelId}/typing`, {
        headers: { cookie },
      }),
      false,
      channelId,
    );
    const history = await routes.history(
      new Request(`${origin}/api/messaging/channels/${channelId}/messages`, {
        headers: { cookie },
      }),
      channelId,
    );
    assert({
      given: 'a member who has spent the typing poll budget',
      should: 'refuse typing alone and leave history to its own read budget',
      actual: [typing.status, history.status === 429],
      expected: [429, false],
    });
  } finally {
    await app.close();
  }
});
