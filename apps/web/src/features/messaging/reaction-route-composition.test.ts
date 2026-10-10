import { assert, setupRitewayBun, test } from 'riteway/bun';
import { fixedClock, sequentialId } from '@daisy/clock';
import { createScriptedAuthorizationTransaction } from '@daisy/db/testing';
import { createMessagingUnitApp } from './messaging-app.test-support';
import { signedMessagingAuth } from './signed-messaging.test-support';
import { typingWorld } from './typing.test-support';
import { composeMessagingReactionRoute } from './reaction-route';
setupRitewayBun();
test('actual app reaction route binds signed identity and canonical operation fence without guessing an optional policy', async () => {
  const f = typingWorld(),
    self = f.accounts[0]!.account;
  const { auth, cookie, user } = await signedMessagingAuth(
    self.actorId,
    'reaction-member@daisy.example.com',
  );
  const accountRows = f.accounts.map((row) =>
    row.account.actorId === self.actorId
      ? {
          ...row,
          account: { ...row.account, userId: String(user.id) },
          age: { ...row.age, userId: String(user.id) },
        }
      : row,
  );
  const { tx, queries } = createScriptedAuthorizationTransaction(
    Array.from({ length: 6 }, (_, index) => [accountRows[index % 2]!.age]),
  );
  const events: unknown[] = [];
  const messageId = 'm'.repeat(24);
  const response = {
    version: 1 as const,
    channelId: f.channel.channelId,
    messageId,
    changeVersion: 9,
    replayed: false,
    reactions: [],
  };
  const app = createMessagingUnitApp({
    clock: fixedClock(f.now),
    ids: sequentialId('reaction-route'),
    messagingPolicy: {
      ...f.policy,
      reactions: { reactionUnits: 8, choices: ['👍'] },
    },
  });
  const bound: typeof app = {
    ...app,
    auth: () => auth,
    database: {
      ...app.database,
      messagingReactionStore: (policy, fence) => {
        events.push(policy);
        return {
          read: async (scope) => {
            events.push(['read', scope]);
            await fence(
              tx,
              scope,
              {
                fact: f.channel,
                accounts: accountRows.map((row) => row.account),
              },
              'read',
            );
            return response;
          },
          change: async (scope, command) => {
            events.push(['change', scope]);
            await fence(
              tx,
              scope,
              {
                fact: f.channel,
                accounts: accountRows.map((row) => row.account),
              },
              command.active ? 'add' : 'remove',
              command.active
                ? undefined
                : {
                    actorId: scope.actorId,
                    channelId: scope.channelId,
                    messageId,
                    reaction: command.reaction,
                  },
            );
            return response;
          },
        };
      },
    },
  };
  const origin = auth.config.PUBLIC_APP_URL;
  const handler = composeMessagingReactionRoute(bound);
  try {
    const read = await handler(
      new Request(`${origin}/reactions?messageId=${messageId}`, {
        headers: { cookie },
      }),
      f.channel.channelId,
    );
    const change = await handler(
      new Request(`${origin}/reactions`, {
        method: 'POST',
        headers: { cookie, origin, 'content-type': 'application/json' },
        body: JSON.stringify({
          version: 1,
          channelId: f.channel.channelId,
          messageId,
          requestId: 'r'.repeat(24),
          reaction: '👍',
          active: true,
        }),
      }),
    );
    const absent = await composeMessagingReactionRoute({
      ...bound,
      messagingPolicy: f.policy,
    })(new Request(`${origin}/reactions`));
    const scope = {
      actorId: self.actorId,
      userId: String(user.id),
      channelId: f.channel.channelId,
    };
    assert({
      given:
        'actual signed session, minimal fact SQL adapter and configured reaction store port',
      should:
        'bind both methods to current canonical authority and keep missing reaction policy unavailable',
      actual: [
        read.status,
        (await read.json()).policy,
        change.status,
        absent.status,
        events,
        queries.length,
      ],
      expected: [
        200,
        { reactionUnits: 8, choices: ['👍'] },
        200,
        503,
        [
          { reactionUnits: 8, choices: ['👍'] },
          ['read', scope],
          { reactionUnits: 8, choices: ['👍'] },
          ['change', scope],
        ],
        4,
      ],
    });
  } finally {
    await app.close();
  }
});
