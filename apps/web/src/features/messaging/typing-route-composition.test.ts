import { assert, setupRitewayBun, test } from 'riteway/bun';
import { fixedClock, sequentialId } from '@daisy/clock';
import { createMessagingUnitApp } from './messaging-app.test-support';
import { messagingUnitPolicy } from './typing.test-support';
import { composeMessagingTypingRoutes } from './typing-route';
import { composeMessagingPreferenceRoutes } from './preference-route';
import { signedMessagingAuth } from './signed-messaging.test-support';
import { typingWorld } from './typing.test-support';
setupRitewayBun();
test('actual optional typing/preference app routes authenticate before configured stores and fail unavailable without explicit typing policy', async () => {
  const policy = messagingUnitPolicy(),
    app = createMessagingUnitApp({
      clock: fixedClock('2026-10-10T12:00:00.000Z'),
      ids: sequentialId('typing-route'),
      messagingPolicy: {
        ...policy,
        typing: { ttlMs: 5000, refetchMs: 1000, maxActors: 2 },
      },
    });
  const origin = app.auth().config.PUBLIC_APP_URL,
    request = () =>
      new Request(origin + '/api/messaging/typing', {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json' },
        body: '{}',
      });
  try {
    const typing = composeMessagingTypingRoutes(app),
      preferences = composeMessagingPreferenceRoutes(app);
    const statuses = [
      (await typing(request(), true)).status,
      (await typing(new Request(origin + '/typing'), false, 'c'.repeat(24)))
        .status,
    ];
    for (const action of ['read', 'update', 'clear'] as const)
      statuses.push(
        (await preferences(request(), action, 'c'.repeat(24))).status,
      );
    const absent = composeMessagingTypingRoutes({
        ...app,
        messagingPolicy: policy,
      }),
      unconfigured = composeMessagingTypingRoutes({
        ...app,
        messagingPolicy: null,
      });
    assert({
      given:
        'actual configured application, anonymous requests and separately absent optional typing policy',
      should:
        'authenticate every store edge and preserve explicit unavailable status without vendor I/O',
      actual: [
        statuses,
        (await absent(request(), true)).status,
        (await unconfigured(request(), false)).status,
        (
          await composeMessagingPreferenceRoutes({
            ...app,
            messagingPolicy: null,
          })(request(), 'clear')
        ).status,
      ],
      expected: [[401, 401, 401, 401, 401], 503, 503, 503],
    });
  } finally {
    await app.close();
  }
});

test('signed-in app typing routes bind the principal and current account fence before any Redis operation', async () => {
  const f = typingWorld(),
    self = f.accounts[0]!.account,
    signed = await signedMessagingAuth(
      self.actorId,
      'typing-member@daisy.example.com',
    );
  const { auth, cookie, user } = signed;
  const observed: unknown[] = [];
  const app = createMessagingUnitApp({
    clock: fixedClock(f.now),
    ids: sequentialId('typing-app'),
    messagingPolicy: {
      ...f.policy,
      typing: { ttlMs: 5000, refetchMs: 1000, maxActors: 2 },
    },
  });
  const tx = {
    execute: () => {
      throw new Error('Nonmember age lookup forbidden');
    },
    insert: () => {
      throw new Error('No insert');
    },
  };
  const bound: typeof app = {
    ...app,
    auth: () => auth,
    database: {
      ...app.database,
      messagingTypingStore: async (scope, budget, work) => {
        observed.push([scope, budget]);
        return work({
          tx,
          fact: f.channel,
          channels: f.channels,
          accounts: f.accounts.map((row) => ({
            ...row.account,
            member: false,
          })),
          notify: async () => {
            throw new Error('No refused hint');
          },
        });
      },
    },
  };
  try {
    const handler = composeMessagingTypingRoutes(bound),
      origin = auth.config.PUBLIC_APP_URL;
    const read = await handler(
      new Request(origin + '/typing', { headers: { cookie } }),
      false,
      f.channel.channelId,
    );
    const write = await handler(
      new Request(origin + '/typing', {
        method: 'POST',
        headers: { cookie, origin, 'content-type': 'application/json' },
        body: JSON.stringify({
          version: 1,
          channelId: f.channel.channelId,
          typing: true,
        }),
      }),
      true,
    );
    assert({
      given:
        'real memory-backed signed session and actual app-bound route factory with current nonmember fence',
      should:
        'resolve principal then deny read/write before Redis, preserving canonical masking',
      actual: [read.status, write.status, observed],
      expected: [
        404,
        403,
        Array(2).fill([
          {
            userId: String(user.id),
            actorId: self.actorId,
            channelId: f.channel.channelId,
          },
          2,
        ]),
      ],
    });
  } finally {
    await app.close();
  }
});
