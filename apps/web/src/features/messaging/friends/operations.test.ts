import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { fixedClock } from '@daisy/clock';
import { createAppError } from '@daisy/errors';
import type { MessagingSocialStore } from '@daisy/db/messaging';
import {
  capabilityFor,
  changeFriendship,
  friendPresenceOf,
  readFriendList,
  type FriendCapability,
} from './operations';
import type { FriendshipPair } from './friendship';

setupRitewayBun();

const me = 'a'.repeat(24),
  them = 'b'.repeat(24),
  userId = 'u'.repeat(24);
const principal = { kind: 'user' as const, userId, actorId: me };
const now = '2026-10-26T18:00:00.000Z';

const harness = ({
  pair = null,
  blocked = false,
  fence = async () => {},
}: {
  readonly pair?: FriendshipPair | null;
  readonly blocked?: boolean;
  readonly fence?: () => Promise<void>;
} = {}) => {
  const commits: unknown[] = [];
  const capabilities: FriendCapability[] = [];
  const limited: string[] = [];
  const store = (capability: FriendCapability): MessagingSocialStore => {
    capabilities.push(capability);
    return {
      withContacts: async (_input, work) => {
        await fence();
        return work({
          contacts: [
            { lowActorId: me, highActorId: them, blocked, revision: 1 },
          ],
          readFriendship: async () => ({
            otherActorId: them,
            pair,
            actorPendingOutgoing: 0,
            actorFriends: 0,
            otherFriends: 0,
          }),
          commitFriendship: async (input: unknown) => {
            commits.push(input);
          },
        } as never);
      },
    };
  };
  return {
    commits,
    capabilities,
    limited,
    dependencies: {
      clock: fixedClock(now),
      limit: async (actorId: string) => {
        limited.push(actorId);
      },
      lookup: async (username: string) =>
        username === 'ada' ? them : username === 'me' ? me : null,
      store,
    },
  };
};

test('a request by username', async () => {
  const run = harness();
  assert({
    given: 'a member with no pair',
    should: 'commit a pending request and report it outgoing',
    actual: await changeFriendship(principal, 'request', 'ada', run.dependencies),
    expected: { username: 'ada', relation: 'outgoing' },
  });
  assert({
    given: 'the committed request',
    should: 'rate-limit the actor and fence with the request capability',
    actual: [run.limited, run.capabilities, run.commits],
    expected: [
      [me],
      ['social.friend.request'],
      [
        {
          previous: null,
          next: { state: 'pending', requesterActorId: me },
          now,
        },
      ],
    ],
  });
});

test('accepting an incoming request', async () => {
  const run = harness({ pair: { state: 'pending', requesterActorId: them } });
  assert({
    given: 'an incoming request',
    should: 'report the pair friends',
    actual: await changeFriendship(principal, 'accept', 'ada', run.dependencies),
    expected: { username: 'ada', relation: 'friends' },
  });
});

test('a repeat that changes nothing writes nothing', async () => {
  const run = harness({ pair: { state: 'accepted', requesterActorId: them } });
  await changeFriendship(principal, 'request', 'ada', run.dependencies);
  assert({
    given: 'a request between friends',
    should: 'commit nothing',
    actual: run.commits,
    expected: [],
  });
});

test('refusals', async () => {
  await assertRejects({
    given: 'an unknown username',
    should: 'refuse as not found',
    actual: () =>
      changeFriendship(principal, 'request', 'nobody', harness().dependencies),
    code: 'NOT_FOUND',
  });
  await assertRejects({
    given: 'the actor’s own username',
    should: 'refuse as validation',
    actual: () =>
      changeFriendship(principal, 'request', 'me', harness().dependencies),
    code: 'VALIDATION',
  });
  await assertRejects({
    given: 'a fence denying the pair (a block)',
    should: 'refuse as not found, never naming the block',
    actual: () =>
      changeFriendship(
        principal,
        'request',
        'ada',
        harness({
          fence: async () => {
            throw createAppError('AUTHORIZATION');
          },
        }).dependencies,
      ),
    code: 'NOT_FOUND',
  });
  await assertRejects({
    given: 'an accept with no incoming request',
    should: 'refuse as a conflict',
    actual: () =>
      changeFriendship(principal, 'accept', 'ada', harness().dependencies),
    code: 'CONFLICT',
  });
  await assertRejects({
    given: 'an anonymous principal',
    should: 'refuse as authentication',
    actual: () =>
      changeFriendship(
        { kind: 'anonymous' },
        'request',
        'ada',
        harness().dependencies,
      ),
    code: 'AUTHENTICATION',
  });
});

test('capabilityFor', () => {
  assert({
    given: 'each command',
    should: 'fence asking and accepting apart from ending',
    actual: (['request', 'accept', 'decline', 'remove'] as const).map(
      capabilityFor,
    ),
    expected: [
      'social.friend.request',
      'social.friend.request',
      'social.friend.end',
      'social.friend.end',
    ],
  });
});

test('readFriendList', async () => {
  const c = 'c'.repeat(24),
    d = 'd'.repeat(24),
    e = 'e'.repeat(24);
  const row = (
    otherActorId: string,
    username: string,
    state: 'pending' | 'accepted',
    requesterActorId: string,
  ) => ({
    otherActorId,
    username,
    state,
    requesterActorId,
    requestedAt: now,
  });
  const asked: (readonly string[])[] = [];
  const list = await readFriendList(principal, {
    list: async () => [
      row(them, 'zed', 'accepted', me),
      row(c, 'bea', 'accepted', c),
      row(e, 'cat', 'accepted', me),
      row(d, 'dan', 'pending', d),
      row('f'.repeat(24), 'eve', 'pending', me),
    ],
    presence: async (ids) => {
      asked.push(ids);
      return new Map([
        [them, 'online' as const],
        [e, 'away' as const],
      ]);
    },
  });
  assert({
    given: 'friends with mixed presence and requests both ways',
    should: 'list online first, then away, then offline, and split requests',
    actual: list,
    expected: {
      friends: [
        { username: 'zed', presence: 'online' },
        { username: 'cat', presence: 'away' },
        { username: 'bea', presence: 'offline' },
      ],
      incoming: [{ username: 'dan', requestedAt: now }],
      outgoing: [{ username: 'eve', requestedAt: now }],
    },
  });
  assert({
    given: 'the presence read',
    should: 'ask only about accepted friends',
    actual: asked,
    expected: [[them, c, e]],
  });
});

test('friendPresenceOf', () => {
  assert({
    given: 'an active, an idle and no live lease',
    should: 'show online, away and offline',
    actual: (['active', 'idle', null] as const).map(friendPresenceOf),
    expected: ['online', 'away', 'offline'],
  });
});
