import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { changeMessagingReaction, readMessagingReactions } from './reactions';
import { typingWorld } from './typing.test-support';
setupRitewayBun();
function fixture() {
  const f = typingWorld(),
    account = f.accounts[0]!.account;
  const input = {
    version: 1,
    channelId: f.channel.channelId,
    messageId: 'm'.repeat(24),
    requestId: 'r'.repeat(24),
    reaction: '👍',
    active: true,
  };
  const response = {
    version: 1 as const,
    channelId: input.channelId,
    messageId: input.messageId,
    changeVersion: 3,
    replayed: false,
    reactions: [{ reaction: '👍', count: 1, own: true }],
  };
  return {
    input,
    response,
    principal: {
      kind: 'user' as const,
      userId: account.userId,
      actorId: account.actorId,
    },
    policy: { reactionUnits: 8, choices: ['👍'] },
  };
}
test('reaction operations bind authenticated actor and hash canonical intent after the explicit rate limit', async () => {
  const f = fixture();
  const events: unknown[] = [],
    digests: string[] = [];
  const dependencies = {
    policy: f.policy,
    limit: async (actorId: string, channelId: string) => {
      events.push(['limit', actorId, channelId]);
    },
    store: {
      read: async () => f.response,
      change: async (scope: unknown, command: unknown, digest: string) => {
        events.push(['change', scope, command]);
        digests.push(digest);
        return f.response;
      },
    },
  };
  await changeMessagingReaction(f.input, f.principal, dependencies);
  await changeMessagingReaction(
    { ...f.input, requestId: 's'.repeat(24) },
    f.principal,
    dependencies,
  );
  await changeMessagingReaction(
    { ...f.input, active: false },
    f.principal,
    dependencies,
  );
  assert({
    given:
      'equivalent payloads with new request IDs and a distinct removal intent',
    should:
      'derive the actor, rate limit before the store and use stable SHA3 fingerprints distinct by operation',
    actual: [
      events[0],
      events[1],
      digests[0]?.length,
      digests[0] === digests[1],
      digests[0] === digests[2],
    ],
    expected: [
      ['limit', f.principal.actorId, f.input.channelId],
      [
        'change',
        {
          userId: f.principal.userId,
          actorId: f.principal.actorId,
          channelId: f.input.channelId,
        },
        f.input,
      ],
      64,
      true,
      false,
    ],
  });
});
test('reaction input and returned scope cannot substitute foreign authority or aggregate metadata', async () => {
  const f = fixture();
  let limits = 0,
    calls = 0;
  const dependencies = {
    policy: f.policy,
    limit: async () => {
      limits++;
    },
    store: {
      read: async () => f.response,
      change: async () => {
        calls++;
        return { ...f.response, channelId: 'x'.repeat(24) };
      },
    },
  };
  await assertRejects({
    given: 'a valid request whose provider returns a foreign channel result',
    should: 'refuse the projection rather than disclose that aggregate',
    actual: () => changeMessagingReaction(f.input, f.principal, dependencies),
    code: 'INFRASTRUCTURE',
  });
  for (const input of [
    { ...f.input, actorId: 'x'.repeat(24) },
    { ...f.input, reaction: '😂' },
  ])
    await assertRejects({
      given: 'forged actor or unsupported addition',
      should: 'reject before limiter and store',
      actual: () => changeMessagingReaction(input, f.principal, dependencies),
      code: 'VALIDATION',
    });
  await assertRejects({
    given: 'an anonymous reaction request',
    should: 'reject before mutable resources',
    actual: () =>
      changeMessagingReaction(f.input, { kind: 'anonymous' }, dependencies),
    code: 'AUTHENTICATION',
  });
  assert({
    given: 'all refused boundary cases',
    should: 'visit resources only for the valid provider-response control',
    actual: [limits, calls],
    expected: [1, 1],
  });
});

test('reaction reading authorizes actor scope before discovery and validates only current bound count metadata', async () => {
  const f = fixture();
  const scopes: unknown[] = [];
  let response = f.response;
  const dependencies = {
    policy: f.policy,
    limit: async (actor: string, channel: string) => {
      scopes.push([actor, channel]);
    },
    store: {
      change: async () => f.response,
      read: async (scope: unknown, message: string) => {
        scopes.push([scope, message]);
        return response;
      },
    },
  };
  const command = {
    version: 1,
    channelId: f.input.channelId,
    messageId: f.input.messageId,
  };
  const result = await readMessagingReactions(
    command,
    f.principal,
    dependencies,
  );
  assert({
    given: 'current identified read intent',
    should:
      'consume the read limit and bind the actual actor/message before returning configured count metadata',
    actual: [scopes, result],
    expected: [
      [
        [f.principal.actorId, f.input.channelId],
        [
          {
            userId: f.principal.userId,
            actorId: f.principal.actorId,
            channelId: f.input.channelId,
          },
          f.input.messageId,
        ],
      ],
      { ...f.response, policy: f.policy },
    ],
  });
  response = { ...f.response, messageId: 'x'.repeat(24) };
  await assertRejects({
    given: 'foreign provider message summary',
    should: 'refuse at the projection boundary',
    actual: () => readMessagingReactions(command, f.principal, dependencies),
    code: 'INFRASTRUCTURE',
  });
  await assertRejects({
    given: 'mutation fields on a read intent',
    should: 'refuse before another protected read',
    actual: () => readMessagingReactions(f.input, f.principal, dependencies),
    code: 'VALIDATION',
  });
});
