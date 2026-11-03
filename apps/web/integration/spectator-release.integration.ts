import { spectatorHorizon, RANKED_DELAY_SECONDS } from '@daisy/debate-engine';
import { readSpectatorHorizon } from '@daisy/db/testing';
import { requireTestServices } from '@daisy/config';
import {
  SPECTATOR_MARGIN_MS,
  type BroadcastReleasePolicy,
} from '@daisy/protocol';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { readRatingStandings } from '../src/features/ratings/read';
import { spectatorClockAt } from '../src/features/spectating/spectator-clock';
import { inArena, minute, type Arena } from './ratings-arena';
import { testDatabaseUrl, withSql } from './fixtures';

requireTestServices(process.env);
setupRitewayBun();

const delayMs = RANKED_DELAY_SECONDS * 1000;
const standard: BroadcastReleasePolicy = {
  kind: 'delay',
  seconds: RANKED_DELAY_SECONDS,
};
const iso = (ms: number) => new Date(ms).toISOString();
const completedAt = Date.parse(minute(30));

type BroadcastState = {
  readonly policy?: BroadcastReleasePolicy;
  readonly releasedThrough?: string | null;
  readonly completed?: string | null;
  readonly stopped?: string | null;
};

const openBroadcast = async (roundId: string, state: BroadcastState) => {
  await withSql(
    (sql) => sql`insert into broadcasts
      (id, round_id, feed_key, release_policy, released_through_at, completed_at, stopped_at, stop_reason)
      values (${createId()}, ${roundId}, ${createId()}, ${state.policy ?? standard},
        ${state.releasedThrough ?? null}, ${state.completed ?? null},
        ${state.stopped ?? null}, ${state.stopped ? 'test' : null})`,
  );
};
const dropBroadcasts = (ids: readonly string[]) =>
  withSql(async (sql) => {
    for (const id of ids)
      await sql`delete from broadcasts where round_id=${id}`;
  });

/** A ranked Round two debaters finished and that was rated, as the arena runs it. */
const ratedRound = async (a: Arena) => {
  const [affirmative, negative] = [await a.actor(), await a.actor()];
  const roundId = await a.round({
    affirmative,
    negative,
    outcome: 'affirmative',
  });
  await a.rate(roundId);
  return { affirmative, negative, roundId };
};

const horizonCases: readonly (readonly [
  string,
  BroadcastState | null,
  'ranked' | 'casual',
  string,
])[] = [
  ['no Broadcast, ranked', null, 'ranked', 'completed'],
  ['no Broadcast, casual', null, 'casual', 'completed'],
  ['no Broadcast, live', null, 'ranked', 'active'],
  ['open, no media', {}, 'ranked', 'completed'],
  [
    'open, media out',
    { releasedThrough: iso(completedAt + 1000) },
    'ranked',
    'completed',
  ],
  [
    'completed',
    {
      releasedThrough: iso(completedAt),
      completed: iso(completedAt + delayMs),
    },
    'ranked',
    'completed',
  ],
  ['stopped', { stopped: iso(completedAt) }, 'ranked', 'completed'],
];

test('the list reads and the snapshot share one rule: SQL equals the engine', async () => {
  await inArena(async (a) => {
    const made: string[] = [];
    try {
      for (const [name, state, competitionType, status] of horizonCases) {
        const [affirmative, negative] = [await a.actor(), await a.actor()];
        const roundId = await a.round({
          affirmative,
          negative,
          competitionType,
          status: status as 'active' | 'completed',
          ...(status === 'completed' ? { outcome: 'affirmative' } : {}),
        });
        made.push(roundId);
        if (state) await openBroadcast(roundId, state);
        const nowMs = completedAt + 2000;
        const expected = spectatorHorizon({
          nowMs,
          competitionType,
          roundTerminal: status === 'completed',
          broadcast: state && {
            policy: state.policy ?? standard,
            releasedThroughMs: state.releasedThrough
              ? Date.parse(state.releasedThrough)
              : null,
            completedAtMs: state.completed ? Date.parse(state.completed) : null,
            stoppedAtMs: state.stopped ? Date.parse(state.stopped) : null,
          },
        });
        assert({
          given: name,
          should: 'give the same horizon in SQL and in the engine',
          actual: await readSpectatorHorizon(
            testDatabaseUrl,
            roundId,
            spectatorClockAt(iso(nowMs)),
          ),
          expected,
        });
      }
    } finally {
      await dropBroadcasts(made);
    }
  });
});

test('standings hold a ranked outcome behind the watermark and release it after', async () => {
  await inArena(async (a) => {
    const { affirmative, roundId } = await ratedRound(a);
    try {
      await openBroadcast(roundId, { releasedThrough: iso(completedAt) });
      const far = iso(completedAt + 100 * delayMs);
      const read = () =>
        a.database.readStandings({
          ladder: 'freestyle',
          seasonIds: [a.seasonId!],
          clock: spectatorClockAt(far),
        });
      const before = await read();
      assert({
        given:
          'a watermark short of the margin, long after the Round by the clock',
        should: 'show neither the posting nor the rating',
        actual: [before.changes.length, before.ratings.length],
        expected: [0, 0],
      });
      const standings = await readRatingStandings(a.database, {
        ladder: 'freestyle',
        seasonId: null,
        now: far,
      });
      assert({
        given: 'member standings before release',
        should: 'carry no posting of the Round',
        actual: standings?.postings.filter((c) => c.roundId === roundId),
        expected: [],
      });
      await withSql(
        (sql) =>
          sql`update broadcasts set released_through_at=${iso(completedAt + SPECTATOR_MARGIN_MS)} where round_id=${roundId}`,
      );
      const after = await read();
      assert({
        given: 'the watermark past the outcome by the margin',
        should: 'release the posting and the rating',
        actual: [
          after.changes.filter((c) => c.actorId === affirmative).length,
          after.ratings.filter((r) => r.actorId === affirmative).length,
        ],
        expected: [1, 1],
      });
    } finally {
      await dropBroadcasts([roundId]);
    }
  });
});

test('a later Round rewinds a rating without hiding what is already public', async () => {
  await inArena(async (a) => {
    const { affirmative, negative, roundId } = await ratedRound(a);
    const heldId = await a.round({
      affirmative,
      negative,
      outcome: 'affirmative',
      completedAt: minute(40),
    });
    await a.rate(heldId);
    try {
      await openBroadcast(heldId, {});
      const read = await a.database.readStandings({
        ladder: 'freestyle',
        seasonIds: [a.seasonId!],
        clock: spectatorClockAt(minute(59)),
      });
      const [first] = await a.ledger(affirmative);
      assert({
        given: 'one released Round and one held, for one debater',
        should: 'stand at the rating the released Round left',
        actual: [
          read.changes
            .filter((c) => c.actorId === affirmative)
            .map((c) => c.roundId),
          read.ratings.find((r) => r.actorId === affirmative)?.rating,
        ],
        expected: [[roundId], first!.rating_after],
      });
    } finally {
      await dropBroadcasts([heldId]);
    }
  });
});

test('a member card holds a rating as the standings do', async () => {
  await inArena(async (a) => {
    const { affirmative, negative, roundId } = await ratedRound(a);
    const heldId = await a.round({
      affirmative,
      negative,
      outcome: 'affirmative',
      completedAt: minute(40),
    });
    await a.rate(heldId);
    try {
      await openBroadcast(heldId, {});
      const clock = spectatorClockAt(minute(59));
      const cards = await a.database.readMemberCards([affirmative], clock);
      const standings = await a.database.readStandings({
        ladder: 'freestyle',
        seasonIds: [a.seasonId!],
        clock,
      });
      const [first] = await a.ledger(affirmative);
      const card = cards.ratings.find((r) => r.actorId === affirmative);
      const standing = standings.ratings.find((r) => r.actorId === affirmative);
      assert({
        given: 'one released Round and one held, for one debater',
        should:
          'stand on the card where the ladder stands them, last rated by the released Round',
        actual: {
          rating: card?.rating,
          deviation: card?.deviation,
          volatility: card?.volatility,
          lastRatedAt: card?.lastRatedAt,
        },
        expected: {
          rating: standing?.rating,
          deviation: standing?.deviation,
          volatility: standing?.volatility,
          lastRatedAt: standings.changes.find(
            (c) => c.actorId === affirmative && c.roundId === roundId,
          )?.occurredAt,
        },
      });
      assert({
        given: 'the same card (control)',
        should: 'be the rating the released Round left',
        actual: card?.rating,
        expected: first!.rating_after,
      });
    } finally {
      await dropBroadcasts([heldId]);
    }
  });
});

test('a debater reading their own Round sees its rating at once', async () => {
  await inArena(async (a) => {
    const { roundId } = await ratedRound(a);
    try {
      await openBroadcast(roundId, {});
      const read = await readRatingStandings(a.database, {
        ladder: 'freestyle',
        seasonId: null,
        now: iso(completedAt + 1000),
        revealRoundId: roundId,
      });
      assert({
        given: 'an authorized Round read before the audience release',
        should: 'carry that Round postings and no wait',
        actual: read?.postings.filter((c) => c.roundId === roundId).length,
        expected: 2,
      });
    } finally {
      await dropBroadcasts([roundId]);
    }
  });
});
