import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createDatabase } from '../src';
import { snapshotFor, withFixture, type Fixture } from './constraint-helpers';

setupRitewayBun();

const { databaseUrl: url } = requireTestServices(process.env);

const at = (day: number, hour = 12) => new Date(Date.UTC(2026, 9, day, hour));

const season = async (
  fixture: Fixture,
  status: 'scheduled' | 'active' | 'closed',
  startsAt: Date,
) => {
  const id = createId();
  await fixture.insert('seasons', {
    id,
    name: `Season ${status}`,
    starts_at: startsAt,
    ends_at:
      status === 'closed' ? new Date(startsAt.getTime() + 86_400_000) : null,
    status,
  });
  return id;
};

/** A completed debate between two actors, outcome as given. */
const completed = async (
  fixture: Fixture,
  input: {
    formatId: string;
    affirmative: string;
    negative: string;
    outcome: string;
  },
) => {
  const id = createId();
  await fixture.insert('debates', {
    id,
    created_by_actor_id: null,
    resolution: 'r',
    format_id: input.formatId,
    snapshot: snapshotFor(id, { phase: 'completed' }),
    mode: 'ranked',
    phase: 'completed',
    visibility: 'public',
    started_at: at(5, 11),
    completed_at: at(5),
    outcome: input.outcome,
  });
  await fixture.participant(id, 'affirmative', 0, input.affirmative);
  await fixture.participant(id, 'negative', 0, input.negative);
  return id;
};

const change = (
  fixture: Fixture,
  row: {
    debateId: string;
    actorId: string;
    formatId: string;
    seasonId: string;
    ladder: string;
    before: number;
    after: number;
    occurredAt: Date;
  },
) =>
  fixture.insert('rating_changes', {
    id: createId(),
    debate_id: row.debateId,
    actor_id: row.actorId,
    format_id: row.formatId,
    season_id: row.seasonId,
    ladder: row.ladder,
    rating_before: row.before,
    rating_after: row.after,
    deviation_before: 350,
    deviation_after: 300,
    volatility_before: 0.06,
    volatility_after: 0.06,
    calculation_version: 'glicko2-v1',
    occurred_at: row.occurredAt,
  });

const rating = (
  fixture: Fixture,
  row: {
    actorId: string;
    formatId: string;
    seasonId: string;
    ladder: string;
    rating: number;
  },
) =>
  fixture.insert(
    'ratings',
    {
      actor_id: row.actorId,
      format_id: row.formatId,
      season_id: row.seasonId,
      ladder: row.ladder,
      rating: row.rating,
      deviation: 300,
      volatility: 0.06,
    },
    'actor_id',
  );

describe('standings reads (RATE-1.4.1)', () => {
  test('lists active and closed seasons newest first, and ranked formats only', async () => {
    await withFixture(url, async (fixture) => {
      const database = createDatabase({ url, nextActorId: createId });
      try {
        const older = await season(fixture, 'closed', at(1));
        const newer = await season(fixture, 'closed', at(3));
        const scheduled = await season(fixture, 'scheduled', at(9));
        const listed = (await database.listLadderSeasons()).map(({ id }) => id);
        const ranked = await fixture.format();
        await fixture.sql.unsafe(
          'update formats set ranked_eligible = true where id = $1',
          [ranked],
        );
        const unranked = await fixture.format();
        const formats = (await database.listRankedFormats()).map(
          ({ id }) => id,
        );
        assert({
          given: 'two closed seasons and a scheduled one',
          should:
            'list the closed seasons newest first and never the scheduled one',
          actual: [
            listed.indexOf(newer) < listed.indexOf(older) &&
              listed.includes(older),
            listed.includes(scheduled),
          ],
          expected: [true, false],
        });
        assert({
          given: 'a ranked-eligible format and one that is not',
          should: 'list only the ranked-eligible one',
          actual: [formats.includes(ranked), formats.includes(unranked)],
          expected: [true, false],
        });
      } finally {
        await database.close();
      }
    });
  });

  test('reads one format, ladder and set of seasons, with tombstoned names', async () => {
    await withFixture(url, async (fixture) => {
      const database = createDatabase({ url, nextActorId: createId });
      try {
        const formatId = await fixture.format();
        const otherFormat = await fixture.format();
        const current = await season(fixture, 'closed', at(1));
        const other = await season(fixture, 'closed', at(2));
        const [winner, loser] = [await fixture.actor(), await fixture.actor()];
        await fixture.sql.unsafe(
          "update users set deleted_at = now(), username = null, email = null, image = null, name = '' where id = (select user_id from actors where id = $1)",
          [loser],
        );
        const debateId = await completed(fixture, {
          formatId,
          affirmative: winner,
          negative: loser,
          outcome: 'affirmative',
        });
        for (const [actorId, value] of [
          [winner, 1516],
          [loser, 1484],
        ] as const) {
          await rating(fixture, {
            actorId,
            formatId,
            seasonId: current,
            ladder: 'ranked',
            rating: value,
          });
          await change(fixture, {
            debateId,
            actorId,
            formatId,
            seasonId: current,
            ladder: 'ranked',
            before: 1500,
            after: value,
            occurredAt: at(5),
          });
        }
        await rating(fixture, {
          actorId: winner,
          formatId,
          seasonId: current,
          ladder: 'quick',
          rating: 1600,
        });
        await rating(fixture, {
          actorId: winner,
          formatId: otherFormat,
          seasonId: current,
          ladder: 'ranked',
          rating: 1700,
        });
        await rating(fixture, {
          actorId: winner,
          formatId,
          seasonId: other,
          ladder: 'ranked',
          rating: 1800,
        });

        const read = await database.readStandings({
          formatId,
          ladder: 'ranked',
          seasonIds: [current],
        });
        const [winnerName] = (await fixture.sql.unsafe(
          'select username from users where id = (select user_id from actors where id = $1)',
          [winner],
        )) as Array<{ username: string }>;
        assert({
          given: 'ratings on two ladders, two formats and two seasons',
          should:
            'return only the ranked rows of that format and season, with a null name for a tombstoned account',
          actual: [...read.ratings]
            .sort((a, b) => b.rating - a.rating)
            .map(({ seasonId, actorId, username, rating: value }) => ({
              seasonId,
              actorId,
              username,
              rating: value,
            })),
          expected: [
            {
              seasonId: current,
              actorId: winner,
              username: winnerName?.username ?? '',
              rating: 1516,
            },
            { seasonId: current, actorId: loser, username: null, rating: 1484 },
          ],
        });
        assert({
          given: 'the debate that produced those ratings',
          should:
            'return each ledger row with its seat role and the debate outcome',
          actual: [...read.changes]
            .sort((a, b) => b.ratingAfter - a.ratingAfter)
            .map(
              ({
                actorId,
                role,
                outcome,
                ratingBefore,
                ratingAfter,
                occurredAt,
              }) => ({
                actorId,
                role,
                outcome,
                ratingBefore,
                ratingAfter,
                occurredAt,
              }),
            ),
          expected: [
            {
              actorId: winner,
              role: 'affirmative',
              outcome: 'affirmative',
              ratingBefore: 1500,
              ratingAfter: 1516,
              occurredAt: at(5).toISOString(),
            },
            {
              actorId: loser,
              role: 'negative',
              outcome: 'affirmative',
              ratingBefore: 1500,
              ratingAfter: 1484,
              occurredAt: at(5).toISOString(),
            },
          ],
        });
      } finally {
        await database.close();
      }
    });
  });
});
