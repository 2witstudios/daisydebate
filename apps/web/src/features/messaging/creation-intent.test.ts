import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { resolveMessagingCreationIntent } from './creation-intent';
setupRitewayBun();
const principal = {
  kind: 'user' as const,
  userId: 'u'.repeat(24),
  actorId: 'a'.repeat(24),
};
const bounds = { introductionUnits: 100, titleUnits: 80, batchActors: 3 };
const requestId = 'r'.repeat(24);
for (const kind of ['dm', 'private_group'] as const) {
  test(`username ${kind} discovery returns intent only and preserves the command identity`, async () => {
    const calls: string[] = [];
    const result = await resolveMessagingCreationIntent(
      kind,
      {
        version: 1,
        requestId,
        ...(kind === 'dm'
          ? {
              recipientUsername: ' Peer_One ',
              introduction: 'Exact introduction',
            }
          : {
              title: 'Private group',
              invitedUsernames: [' Peer_One ', 'peer-two'],
            }),
      },
      principal,
      {
        bounds,
        limit: async () => {
          calls.push('limit');
        },
        lookup: async (username) => {
          calls.push(username);
          return username === 'peer_one' ? 'b'.repeat(24) : 'c'.repeat(24);
        },
      },
    );
    assert({
      given: 'normalized username intent after the actor boundary',
      should:
        'discover minimal actor IDs after rate limiting without creating membership',
      actual: { calls, result },
      expected: {
        calls:
          kind === 'dm'
            ? ['limit', 'peer_one']
            : ['limit', 'peer_one', 'peer-two'],
        result:
          kind === 'dm'
            ? {
                version: 1,
                requestId,
                recipientActorId: 'b'.repeat(24),
                introduction: 'Exact introduction',
              }
            : {
                version: 1,
                requestId,
                title: 'Private group',
                invitedActorIds: ['b'.repeat(24), 'c'.repeat(24)],
              },
      },
    });
  });
}
test('username intent refuses invalid input and identity before lookup and leaves missing recipients unavailable', async () => {
  const calls: string[] = [];
  const deps = {
    bounds,
    limit: async () => {
      calls.push('limit');
    },
    lookup: async () => {
      calls.push('lookup');
      return null;
    },
  };
  for (const recipientUsername of ['Kelvin', 'xx'])
    await assertRejects({
      given: 'an invalid canonical username',
      should: 'refuse before discovery',
      actual: () =>
        resolveMessagingCreationIntent(
          'dm',
          { version: 1, requestId, recipientUsername },
          principal,
          deps,
        ),
      code: 'VALIDATION',
    });
  await assertRejects({
    given: 'anonymous intent',
    should: 'authenticate before lookup',
    actual: () =>
      resolveMessagingCreationIntent('dm', {}, { kind: 'anonymous' }, deps),
    code: 'AUTHENTICATION',
  });
  await assertRejects({
    given: 'duplicate normalized group names',
    should: 'refuse ambiguous recipients before lookup',
    actual: () =>
      resolveMessagingCreationIntent(
        'private_group',
        {
          version: 1,
          requestId,
          title: 'Group',
          invitedUsernames: ['Peer', 'PEER'],
        },
        principal,
        deps,
      ),
    code: 'VALIDATION',
  });
  assert({
    given: 'invalid or anonymous requests',
    should: 'perform no discovery',
    actual: calls,
    expected: [],
  });
  await assertRejects({
    given: 'no current eligible username intent',
    should: 'refuse without an authority or membership fallback',
    actual: () =>
      resolveMessagingCreationIntent(
        'dm',
        { version: 1, requestId, recipientUsername: 'peer' },
        principal,
        deps,
      ),
    code: 'AUTHORIZATION',
  });
});
