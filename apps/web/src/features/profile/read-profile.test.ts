import type { Identity } from '@daisy/auth';
import { assertRejects } from '@daisy/errors/testing';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { judgePanel, readProfile, type ProfileStore } from './read-profile';

setupRitewayBun();

const owner = { userId: 'u'.repeat(24), actorId: 'a'.repeat(24) };
const other = { userId: 'v'.repeat(24), actorId: 'b'.repeat(24) };
const roundId = 'r'.repeat(24);
const limiter = {
  consume: async () => ({ allowed: true, retryAfterSeconds: 0 }),
};
const row = {
  roundId,
  completedAt: '2026-10-26T12:00:00.000Z',
  resolution: 'This house would ban homework',
  visibility: 'public',
  outcome: 'negative',
  role: 'affirmative',
  forfeit: true,
  seats: [
    { role: 'affirmative', kind: 'human', label: 'debater-a' },
    { role: 'affirmative', kind: 'human', label: 'teammate' },
    { role: 'negative', kind: 'bot', label: 'Socrates' },
    { role: 'negative', kind: 'human', label: null },
    { role: 'judge', kind: 'bot', label: 'Judge bot' },
  ],
} as const;

const member = (who: typeof owner): Identity => ({
  state: 'member',
  username: 'viewer',
  principal: { kind: 'user', ...who },
});
const visitor: Identity = {
  state: 'anonymous',
  principal: { kind: 'anonymous' },
};
/** The account fact the database would read fresh for a caller. */
const accountOf = (
  who: typeof owner,
  overrides: Partial<{ member: boolean; erased: boolean }> = {},
) => ({
  userId: who.userId,
  actorId: who.actorId,
  member: true,
  beta: { state: 'approved' as const, revision: 1 },
  ageBand: 'adult' as const,
  erased: false,
  revision: 2,
  ...overrides,
});

/**
 * A store over the owner's profile that, like the database, reads the
 * caller's account in its snapshot and asks `decide` for the scope.
 */
const storeFor = (
  found: boolean,
  account: ReturnType<typeof accountOf> | null = null,
) => {
  const reads: unknown[] = [];
  const store: ProfileStore = {
    readMemberProfile: async (input) => {
      reads.push({
        caller: input.caller,
        before: input.before,
        limit: input.limit,
      });
      if (!found) return null;
      const scope = input.decide(
        owner.actorId,
        input.caller === null ? null : account,
      );
      return {
        member: {
          ...owner,
          username: 'debater-a',
          memberSince: '2026-09-01T00:00:00.000Z',
        },
        scope,
        groups: [
          {
            status: 'completed',
            outcome: 'affirmative',
            role: 'affirmative',
            rounds: 2,
          },
          { status: 'completed', outcome: null, role: 'negative', rounds: 1 },
        ],
        rows: [row],
        nextBefore: roundId,
      };
    },
  };
  return { store, reads };
};

const profileFor = (
  identity: Identity,
  account: ReturnType<typeof accountOf> | null = null,
  query: { before?: string } = {},
) => {
  const { store, reads } = storeFor(true, account);
  return readProfile(
    { store, limiter },
    { identity, username: 'debater-a', query },
  ).then((profile) => ({ profile, reads }));
};

describe('readProfile', () => {
  test('a visitor', async () => {
    const { profile, reads } = await profileFor(visitor);
    assert({
      given: 'a visitor and a member with a forfeited loss against a team',
      should:
        'read with no caller in the public scope, tally the record and list the opposing seats from the member’s side',
      actual: {
        me: profile?.me,
        record: profile?.record,
        reads,
        entry: profile?.history[0],
        nextBefore: profile?.nextBefore,
      },
      expected: {
        me: false,
        record: { wins: 2, losses: 0, draws: 0 },
        reads: [{ caller: null, before: null, limit: 20 }],
        entry: {
          roundId,
          completedAt: row.completedAt,
          resolution: row.resolution,
          side: 'affirmative',
          opponents: [
            { kind: 'bot', label: 'Socrates' },
            { kind: 'human', label: null },
          ],
          result: 'loss',
          forfeit: true,
          judges: 'ai',
          visibility: 'public',
        },
        nextBefore: roundId,
      },
    });
  });

  test('the owner, paging back', async () => {
    const { profile, reads } = await profileFor(
      member(owner),
      accountOf(owner),
      { before: roundId },
    );
    assert({
      given: 'the signed-in owner whose fresh account is current',
      should: 'pass the caller and cursor, and read in the owner’s scope',
      actual: [profile?.me, reads],
      expected: [true, [{ caller: owner, before: roundId, limit: 20 }]],
    });
  });

  test('scopes other than the owner’s', async () => {
    const results = await Promise.all([
      profileFor(member(other), accountOf(other)),
      profileFor(member(owner), accountOf(owner, { member: false })),
      profileFor(member(owner), accountOf(owner, { erased: true })),
      profileFor(member(owner), null),
    ]);
    assert({
      given:
        'another member, and the owner whose fresh account is provisional, erased or gone',
      should: 'read each in the public scope',
      actual: results.map(({ profile }) => profile?.me),
      expected: [false, false, false, false],
    });
  });

  test('refusals', async () => {
    const { store, reads } = storeFor(true);
    await assertRejects({
      given: 'an unreadable session',
      should: 'refuse as an outage before any read',
      actual: () =>
        readProfile(
          { store, limiter },
          {
            identity: {
              state: 'unavailable',
              principal: { kind: 'anonymous' },
            },
            username: 'debater-a',
            query: {},
          },
        ),
      code: 'INFRASTRUCTURE',
    });
    const missing = storeFor(false);
    assert({
      given: 'the unreadable session, then a name with no live member',
      should: 'have read nothing, then answer null',
      actual: [
        reads.length,
        await readProfile(
          { store: missing.store, limiter },
          {
            identity: visitor,
            username: 'nobody',
            query: {},
          },
        ),
      ],
      expected: [0, null],
    });
  });
});

describe('judgePanel', () => {
  test('who ruled', () => {
    const seat = (role: string, kind: 'human' | 'bot') => ({ role, kind });
    assert({
      given: 'no judges, AI judges, human judges, and both',
      should: 'name the panel, ignoring debater seats',
      actual: [
        judgePanel([seat('affirmative', 'bot')]),
        judgePanel([seat('judge', 'bot'), seat('negative', 'human')]),
        judgePanel([seat('judge', 'human'), seat('affirmative', 'bot')]),
        judgePanel([seat('judge', 'human'), seat('judge', 'bot')]),
      ],
      expected: ['none', 'ai', 'human', 'mixed'],
    });
  });
});

test('profile budget refusals precede every durable profile read', async () => {
  for (const [decision, code] of [
    [{ allowed: false, retryAfterSeconds: 60 }, 'RATE_LIMIT'],
    [null, 'INFRASTRUCTURE'],
  ] as const) {
    const { store, reads } = storeFor(true);
    await assertRejects({
      given:
        'an anonymous server-render request with a denied or broken budget',
      should: 'fail closed before profile database access',
      actual: () =>
        readProfile(
          {
            store,
            limiter: { consume: async () => decision! },
          },
          { identity: visitor, username: 'debater-a', query: {} },
        ),
      code,
    });
    assert({
      given: 'the refused server render',
      should: 'perform no database reads',
      actual: reads.length,
      expected: 0,
    });
  }
});

test('profile read budgets cannot be split by username or history cursor', async () => {
  const { store } = storeFor(true);
  const budgets: unknown[] = [];
  const budget = {
    consume: async (
      key: string,
      rule: { max: number; windowSeconds: number },
    ) => {
      budgets.push([key, rule]);
      return { allowed: true, retryAfterSeconds: 0 };
    },
  };
  for (const username of ['debater-a', 'different-member'])
    await readProfile(
      { store, limiter: budget },
      {
        identity: visitor,
        username,
        query: { before: roundId },
        clientId: 'trusted-client',
      },
    );
  assert({
    given: 'two anonymous reads across names and cursor pages',
    should: 'share both client and global database budgets',
    actual: budgets,
    expected: [0, 1].flatMap(() => [
      ['profile:read:client:trusted-client', { max: 60, windowSeconds: 60 }],
      ['profile:read:global', { max: 600, windowSeconds: 60 }],
    ]),
  });
});
