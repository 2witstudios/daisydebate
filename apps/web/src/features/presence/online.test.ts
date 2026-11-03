import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import {
  ADMITTED_AGE_BANDS,
  type AuthorizationPrincipal,
} from '@daisy/auth/authorization';
import {
  decodeRosterCursor,
  encodeRosterCursor,
  readOnlineRoster,
  ROSTER_PAGE,
  shownLadders,
  type OnlineRosterDependencies,
} from './online';

setupRitewayBun();

const me = 'a'.repeat(24);
const ada = 'b'.repeat(24);
const bea = 'c'.repeat(24);
const member = {
  kind: 'user',
  userId: 'u'.repeat(24),
  actorId: me,
  sessionId: 's'.repeat(24),
} as unknown as AuthorizationPrincipal;

const row = (actorId: string, username: string, overrides = {}) => ({
  actorId,
  username,
  chosen: 'online' as const,
  placement: null,
  friend: false,
  online: true,
  requesterActorId: null,
  friendshipState: null,
  ...overrides,
});

const deps = (
  overrides: Partial<OnlineRosterDependencies> = {},
): OnlineRosterDependencies => ({
  now: () => '2026-11-02T00:00:00.000Z',
  limit: async () => {},
  onlineActorIds: async () => [me, ada, bea],
  activity: async () =>
    new Map([
      [me, 'active' as const],
      [ada, 'active' as const],
      [bea, 'idle' as const],
    ]),
  page: async () => ({
    rows: [
      row(ada, 'ada', { friend: true, friendshipState: 'accepted' }),
      row(bea, 'bea'),
    ],
    counts: { everyone: 2, friends: 1, online: 2 },
    self: { chosen: 'busy', placement: null },
  }),
  cards: async () => ({ visibility: [], ratings: [], records: [] }),
  blinded: async () => [],
  ...overrides,
});

const read = (overrides: Partial<OnlineRosterDependencies> = {}) =>
  readOnlineRoster(
    member,
    { filter: 'all', query: null, cursor: undefined },
    deps(overrides),
  );

describe('shownLadders', () => {
  test('Freestyle always, the others by choice', () => {
    assert({
      given: 'no choice, Policy on, and both on',
      should: 'show Freestyle alone, then add what they turned on',
      actual: [
        shownLadders(undefined),
        shownLadders({ showPolicy: true, showValue: false }),
        shownLadders({ showPolicy: true, showValue: true }),
      ],
      expected: [
        ['freestyle'],
        ['freestyle', 'policy'],
        ['freestyle', 'policy', 'value'],
      ],
    });
  });
});

describe('readOnlineRoster', () => {
  test('each row carries its status, relation and the viewer’s own status', async () => {
    const roster = await read();
    assert({
      given: 'a friend online, a stranger idle, and a viewer who chose Busy',
      should: 'show online and away, name the friend, and report Busy for self',
      actual: {
        rows: roster.members.map((m) => [m.username, m.status, m.relation]),
        self: roster.self,
        counts: roster.counts,
      },
      expected: {
        rows: [
          ['ada', 'online', 'friends'],
          ['bea', 'away', 'none'],
        ],
        self: 'busy',
        counts: { everyone: 2, friends: 1, online: 2 },
      },
    });
  });

  test('the read takes its age rule from the one admission rule', async () => {
    const seen: unknown[] = [];
    const base = deps();
    await read({
      page: (scope, input) => {
        seen.push(input.admittedAgeBands);
        return base.page(scope, input);
      },
    });
    assert({
      given: 'a read of the list',
      should: 'ask for exactly the bands the account floor admits',
      actual: seen,
      expected: [ADMITTED_AGE_BANDS],
    });
  });

  test('an offline member stays on the list', async () => {
    const roster = await read({
      activity: async () => new Map([[me, 'active' as const]]),
      page: async () => ({
        rows: [
          row(ada, 'ada', { online: false }),
          row(bea, 'bea', { online: false, chosen: 'appearing_offline' }),
        ],
        counts: { everyone: 2, friends: 0, online: 0 },
        self: { chosen: 'online', placement: null },
      }),
    });
    assert({
      given: 'a member with no lease and one appearing offline',
      should: 'list both as offline, with nothing telling them apart',
      actual: roster.members.map((m) => [m.username, m.status]),
      expected: [
        ['ada', 'offline'],
        ['bea', 'offline'],
      ],
    });
  });

  test('being in a Round or a room shows on its own', async () => {
    const roster = await read({
      page: async () => ({
        rows: [
          row(ada, 'ada', { placement: 'round' }),
          row(bea, 'bea', { placement: 'room', chosen: 'busy' }),
        ],
        counts: { everyone: 2, friends: 0, online: 2 },
        self: { chosen: 'online', placement: 'room' },
      }),
    });
    assert({
      given: 'one member in a Round and one in a room who chose Busy',
      should: 'show each placement, for the viewer too',
      actual: [roster.members.map((m) => m.status), roster.self],
      expected: [['round', 'room'], 'room'],
    });
  });

  test('a lease that lapsed since the scan reads as offline', async () => {
    const roster = await read({
      activity: async () =>
        new Map([
          [me, 'active' as const],
          [ada, null],
          [bea, 'active' as const],
        ]),
    });
    assert({
      given: 'a member whose lease went between the two reads',
      should: 'keep them on the page as offline',
      actual: roster.members.map((m) => [m.username, m.status]),
      expected: [
        ['ada', 'offline'],
        ['bea', 'online'],
      ],
    });
  });

  test('a card shows only the ratings its owner turned on', async () => {
    const state = (
      actorId: string,
      ladder: 'freestyle' | 'policy' | 'value',
    ) => ({
      actorId,
      ladder,
      rating: 1600.4,
      deviation: 40,
      volatility: 0.06,
      lastRatedAt: '2026-11-01T00:00:00.000Z',
    });
    const roster = await read({
      cards: async () => ({
        visibility: [{ actorId: ada, showPolicy: true, showValue: false }],
        ratings: [
          state(ada, 'freestyle'),
          state(ada, 'policy'),
          state(ada, 'value'),
          state(bea, 'policy'),
        ],
        records: [
          {
            actorId: ada,
            status: 'completed',
            outcome: 'affirmative',
            role: 'affirmative',
            rounds: 3,
          },
          {
            actorId: ada,
            status: 'completed',
            outcome: 'negative',
            role: 'affirmative',
            rounds: 1,
          },
        ],
      }),
    });
    assert({
      given: 'Ada showing Policy, and Bea rated on Policy but not showing it',
      should:
        'leave Value off Ada’s card, Policy off Bea’s, and tally the record',
      actual: roster.members.map((m) => ({
        ratings: m.ratings.map((r) => [r.ladder, r.rating]),
        record: [m.wins, m.losses],
      })),
      expected: [
        {
          ratings: [
            ['freestyle', 1600],
            ['policy', 1600],
          ],
          record: [3, 1],
        },
        { ratings: [['freestyle', null]], record: [0, 0] },
      ],
    });
  });

  test('a judge’s blinded debater shows no rating', async () => {
    const roster = await read({
      blinded: async () => [ada],
      cards: async () => ({
        visibility: [],
        ratings: [
          {
            actorId: ada,
            ladder: 'freestyle',
            rating: 1500,
            deviation: 40,
            volatility: 0.06,
            lastRatedAt: null,
          },
        ],
        records: [],
      }),
    });
    assert({
      given: 'a viewer judging Ada with no ballot yet',
      should: 'hide the rating from them and say so',
      actual: roster.members[0]?.ratings[0],
      expected: {
        ladder: 'freestyle',
        rating: null,
        provisional: false,
        hidden: true,
      },
    });
  });

  test('a full page names where the next one starts', async () => {
    const rows = Array.from({ length: ROSTER_PAGE + 1 }, (_, index) =>
      row(`${String(index).padStart(2, '0')}${'d'.repeat(22)}`, `m${index}`),
    );
    const roster = await read({
      activity: async (ids) =>
        new Map(ids.map((id) => [id, 'active' as const])),
      page: async () => ({
        rows,
        counts: { everyone: rows.length, friends: 0, online: rows.length },
        self: { chosen: 'online', placement: null },
      }),
    });
    const last = rows[ROSTER_PAGE - 1]!;
    assert({
      given: 'one row more than a page',
      should: 'answer a page and a cursor at its last row',
      actual: [roster.members.length, decodeRosterCursor(roster.nextCursor!)],
      expected: [
        ROSTER_PAGE,
        {
          friend: false,
          online: true,
          username: last.username,
          actorId: last.actorId,
        },
      ],
    });
  });

  test('the budget is spent before anything is read', async () => {
    const seen: string[] = [];
    await read({
      limit: async () => {
        seen.push('limit');
      },
      onlineActorIds: async () => {
        seen.push('scan');
        return [];
      },
    });
    assert({
      given: 'a read',
      should: 'spend its budget first',
      actual: seen,
      expected: ['limit', 'scan'],
    });
  });
});

describe('roster cursors', () => {
  test('round trip, and refuse anything tampered', async () => {
    const cursor = {
      friend: true,
      online: false,
      username: 'ada',
      actorId: ada,
    };
    assert({
      given: 'an encoded position',
      should: 'decode to itself',
      actual: decodeRosterCursor(encodeRosterCursor(cursor)),
      expected: cursor,
    });
    await assertRejects({
      given: 'a cursor that is not one of ours',
      should: 'refuse rather than probe',
      code: 'VALIDATION',
      actual: async () =>
        decodeRosterCursor(Buffer.from('[1,2,3]').toString('base64url')),
    });
  });
});
