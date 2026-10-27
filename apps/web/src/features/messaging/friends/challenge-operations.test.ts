import { assert, setupRitewayBun, test } from 'riteway/bun';
import { friendTestPorts } from './friend-ports.test-support';
import { assertRejects } from '@daisy/errors/testing';
import { createAppError } from '@daisy/errors';
import type { MessagingSocialStore } from '@daisy/db/messaging';
import { changeChallenge } from './challenge-operations';
import type { FriendshipPair } from './friendship';

setupRitewayBun();

const me = 'a'.repeat(24),
  them = 'b'.repeat(24),
  room = 'r'.repeat(24);
const principal = {
  kind: 'user' as const,
  userId: 'u'.repeat(24),
  actorId: me,
};
const now = '2026-10-26T18:00:00.000Z';

const harness = ({
  pair = { state: 'accepted', requesterActorId: them } as FriendshipPair | null,
  recorded = true,
  fence = async () => {},
} = {}) => {
  const writes: unknown[] = [];
  const capabilities: string[] = [];
  const store = (capability: string): MessagingSocialStore => {
    capabilities.push(capability);
    return {
      withContacts: async (_input, work) => {
        await fence();
        return work({
          readFriendship: async () => ({
            otherActorId: them,
            pair,
            actorPendingOutgoing: 0,
            actorFriends: 1,
            otherFriends: 1,
          }),
          commitChallenge: async (input: unknown) => {
            writes.push(['challenge', input]);
            return { recorded };
          },
          declineChallenge: async (input: unknown) => {
            writes.push(['decline', input]);
          },
        } as never);
      },
    };
  };
  return {
    writes,
    capabilities,
    dependencies: {
      ...friendTestPorts(now),
      limit: async () => {},
      lookup: async (name: string) => (name === 'bea' ? them : null),
      store,
    },
  };
};

test('a challenge to a friend records the room for them', async () => {
  const run = harness();
  assert({
    given: 'an accepted friend and a room the caller hosts',
    should: 'fence with the request capability and record the challenge',
    actual: [
      await changeChallenge(
        principal,
        'challenge',
        { username: 'bea', roomId: room },
        run.dependencies,
      ),
      run.capabilities,
      run.writes,
    ],
    expected: [
      { username: 'bea', relation: 'friends' },
      ['social.friend.request'],
      [['challenge', { roomId: room, now }]],
    ],
  });
});

test('refusals', async () => {
  await assertRejects({
    given: 'a member who is only asked, not a friend',
    should: 'refuse as not found and record nothing',
    actual: () =>
      changeChallenge(
        principal,
        'challenge',
        { username: 'bea', roomId: room },
        harness({ pair: { state: 'pending', requesterActorId: me } })
          .dependencies,
      ),
    code: 'NOT_FOUND',
  });
  await assertRejects({
    given: 'a room the caller does not host or that no longer assembles',
    should: 'refuse as a conflict',
    actual: () =>
      changeChallenge(
        principal,
        'challenge',
        { username: 'bea', roomId: room },
        harness({ recorded: false }).dependencies,
      ),
    code: 'CONFLICT',
  });
  await assertRejects({
    given: 'a fence denying the pair (a block)',
    should: 'refuse as not found, never naming the block',
    actual: () =>
      changeChallenge(
        principal,
        'challenge',
        { username: 'bea', roomId: room },
        harness({
          fence: async () => {
            throw createAppError('AUTHORIZATION');
          },
        }).dependencies,
      ),
    code: 'NOT_FOUND',
  });
  await assertRejects({
    given: 'an unknown username',
    should: 'refuse as not found',
    actual: () =>
      changeChallenge(
        principal,
        'challenge',
        { username: 'nobody', roomId: room },
        harness().dependencies,
      ),
    code: 'NOT_FOUND',
  });
});

test('declining is open to the challenged member, friend or not', async () => {
  const run = harness({ pair: null });
  await changeChallenge(
    principal,
    'decline',
    { username: 'bea', roomId: room },
    run.dependencies,
  );
  assert({
    given: 'a decline after the friendship ended',
    should: 'fence with the end capability and decline the room',
    actual: [run.capabilities, run.writes],
    expected: [['social.friend.end'], [['decline', { roomId: room }]]],
  });
});
