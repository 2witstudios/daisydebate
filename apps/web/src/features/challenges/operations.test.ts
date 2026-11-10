import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createAppError } from '@daisy/errors';
import { fixedClock } from '@daisy/clock';
import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import type { ChallengeFrame, ChallengeStore } from '@daisy/db/challenges';
import {
  acceptChallenge,
  CHALLENGE_TTL_MS,
  challengeListOf,
  endChallenge,
  sendChallenge,
  type ChallengeDependencies,
} from './operations';

setupRitewayBun();

const me = 'a'.repeat(24);
const them = 'b'.repeat(24);
const id = 'c'.repeat(24);
const room = 'r'.repeat(24);
const now = '2026-11-02T00:00:00.000Z';
const member = {
  kind: 'user',
  userId: 'u'.repeat(24),
  actorId: me,
  sessionId: 's'.repeat(24),
} as unknown as AuthorizationPrincipal;

const harness = (overrides: Partial<ChallengeDependencies> = {}) => {
  const calls: unknown[] = [];
  const frame: ChallengeFrame = {
    otherActorId: them,
    send: async (input) => {
      calls.push(['send', input]);
      return { challengeId: input.id };
    },
    accept: async (input) => {
      calls.push(['accept', input]);
    },
    remove: async (input) => {
      calls.push(['remove', input]);
    },
  };
  const store: ChallengeStore = {
    withContacts: async (input, work) => {
      calls.push(['fence', input.memberActorIds]);
      return work(frame);
    },
  };
  let ids = 0;
  const dependencies: ChallengeDependencies = {
    clock: fixedClock(now),
    nextId: () => `id${String(++ids).padStart(22, '0')}`,
    limit: async () => {},
    limitSend: async () => {},
    rankedOpen: async () => true,
    formatOffered: async () => true,
    discover: async () => them,
    activity: async () => 'active',
    store: (capability) => {
      calls.push(['capability', capability]);
      return store;
    },
    counterpart: async () => them,
    ...overrides,
  };
  return { calls, dependencies };
};

const offer = {
  commandId: id,
  username: 'ada',
  mode: 'ranked',
  format: 'policy',
} as const;

describe('sendChallenge', () => {
  test('offers ranked or casual to anyone, friend or not', async () => {
    const { calls, dependencies } = harness();
    const answer = await sendChallenge(member, offer, dependencies);
    assert({
      given: 'a ranked Policy challenge to a member who is online',
      should:
        'fence the pair and record the offer, expiring in two minutes, with ids for its notification and email',
      actual: { answer, calls },
      expected: {
        answer: { challengeId: id, state: 'sent' },
        calls: [
          ['capability', 'social.challenge.send'],
          ['fence', [me, them]],
          [
            'send',
            {
              id,
              notificationId: 'id0000000000000000000001',
              emailJobId: 'id0000000000000000000002',
              mode: 'ranked',
              format: 'policy',
              now,
              expiresAt: new Date(
                Date.parse(now) + CHALLENGE_TTL_MS,
              ).toISOString(),
            },
          ],
        ],
      },
    });
  });

  test('someone with no lease is refused like anyone unavailable', async () => {
    const { calls, dependencies } = harness({ activity: async () => null });
    await assertRejects({
      given: 'a member with no live lease',
      should: 'answer as for no such member, touching no pair',
      code: 'NOT_FOUND',
      actual: () => sendChallenge(member, offer, dependencies),
    });
    assert({
      given: 'that refusal',
      should: 'reach no store',
      actual: calls,
      expected: [],
    });
  });

  test('an unknown name or yourself answers the same', async () => {
    for (const discovered of [null, me]) {
      const { dependencies } = harness({ discover: async () => discovered });
      await assertRejects({
        given: 'no such member, or the caller themself',
        should: 'answer NOT_FOUND',
        code: 'NOT_FOUND',
        actual: () => sendChallenge(member, offer, dependencies),
      });
    }
  });

  test('a block is indistinguishable from no such member', async () => {
    const { dependencies } = harness({
      store: () => ({
        withContacts: async () => {
          throw createAppError('AUTHORIZATION');
        },
      }),
    });
    await assertRejects({
      given: 'a fence that refuses',
      should: 'answer NOT_FOUND, never saying why',
      code: 'NOT_FOUND',
      actual: () => sendChallenge(member, offer, dependencies),
    });
  });
});

describe('a ranked offer', () => {
  test('is refused while no season is active, touching no pair', async () => {
    const { calls, dependencies } = harness({ rankedOpen: async () => false });
    await assertRejects({
      given: 'no active season',
      should: 'refuse at send, not at Accept',
      code: 'INVARIANT',
      actual: () => sendChallenge(member, offer, dependencies),
    });
    assert({
      given: 'that refusal',
      should: 'reach no store',
      actual: calls,
      expected: [],
    });
  });
});

describe('acceptChallenge', () => {
  test('names the room on the offer', async () => {
    const { calls, dependencies } = harness();
    const answer = await acceptChallenge(
      member,
      { challengeId: id, roomId: room },
      dependencies,
    );
    assert({
      given: 'an offer and the room the acceptor just opened',
      should: 'record it under the pair’s fence',
      actual: { answer, last: calls.at(-1) },
      expected: {
        answer: { challengeId: id, state: 'accepted' },
        last: [
          'accept',
          {
            challengeId: id,
            roomId: room,
            now,
            followUntil: new Date(
              Date.parse(now) + CHALLENGE_TTL_MS,
            ).toISOString(),
          },
        ],
      },
    });
  });

  test('an offer that names someone else is not found', async () => {
    const { dependencies } = harness({ counterpart: async () => null });
    await assertRejects({
      given: 'no offer naming this member',
      should: 'answer NOT_FOUND',
      code: 'NOT_FOUND',
      actual: () =>
        acceptChallenge(
          member,
          { challengeId: id, roomId: room },
          dependencies,
        ),
    });
  });
});

describe('endChallenge', () => {
  test('declining and cancelling take their own side', async () => {
    const declined = harness();
    const cancelled = harness();
    await endChallenge(member, 'decline', id, declined.dependencies);
    await endChallenge(member, 'cancel', id, cancelled.dependencies);
    assert({
      given: 'a decline and a cancel',
      should: 'use each capability and remove from that side',
      actual: [
        declined.calls[0],
        declined.calls.at(-1),
        cancelled.calls[0],
        cancelled.calls.at(-1),
      ],
      expected: [
        ['capability', 'social.challenge.decline'],
        ['remove', { challengeId: id, role: 'challenged' }],
        ['capability', 'social.challenge.cancel'],
        ['remove', { challengeId: id, role: 'challenger' }],
      ],
    });
  });

  test('ending one already gone answers the same', async () => {
    const { calls, dependencies } = harness({ counterpart: async () => null });
    assert({
      given: 'an offer no longer there',
      should: 'answer done, touching no pair',
      actual: [await endChallenge(member, 'decline', id, dependencies), calls],
      expected: [{ challengeId: id, state: 'declined' }, []],
    });
  });
});

describe('challengeListOf', () => {
  const row = (over: object) => ({
    id,
    direction: 'incoming' as const,
    actorId: them,
    username: 'ada',
    mode: 'casual' as const,
    format: 'value' as const,
    roomId: null,
    createdAt: now,
    expiresAt: now,
    ...over,
  });
  test('splits what waits, what is awaited, and where the challenger goes', () => {
    const list = challengeListOf([
      row({ id: '1'.repeat(24) }),
      row({ id: '2'.repeat(24), direction: 'outgoing' }),
      row({ id: '3'.repeat(24), direction: 'outgoing', roomId: room }),
      row({ id: '4'.repeat(24), direction: 'incoming', roomId: room }),
    ]);
    assert({
      given: 'one of each, and an offer this member accepted themself',
      should: 'send only the challenger on to the room: the acceptor holds it',
      actual: [
        list.incoming.map((o) => o.id[0]),
        list.outgoing.map((o) => o.id[0]),
        list.accepted.map((o) => o.id[0]),
      ],
      expected: [['1'], ['2'], ['3']],
    });
  });
});
