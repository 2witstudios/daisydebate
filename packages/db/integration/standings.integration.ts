import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createDatabase } from '../src';
import { withFixture } from './constraint-helpers';
import {
  at,
  change,
  completed,
  formatNamed,
  rating,
  season,
} from './standings-fixtures';

setupRitewayBun();

const { databaseUrl: url } = requireTestServices(process.env);

describe('standings reads (RATE-1.4.1)', () => {
  test('lists active and closed seasons newest first, and ranked formats by name', async () => {
    await withFixture(url, async (fixture) => {
      const database = createDatabase({ url, nextActorId: createId });
      try {
        const older = await season(fixture, 'closed', at(1));
        const newer = await season(fixture, 'closed', at(3));
        const active = await season(fixture, 'active', at(7));
        const scheduled = await season(fixture, 'scheduled', at(9));
        const mine = new Set([older, newer, active, scheduled]);
        const listed = (await database.listLadderSeasons())
          .map(({ id }) => id)
          .filter((id) => mine.has(id));
        const zulu = await formatNamed(fixture, 'Zulu fixture');
        const alpha = await formatNamed(fixture, 'Alpha fixture');
        const unranked = await fixture.format();
        // Ranked-eligibility is not a flag: a format is ranked-eligible
        // because a sanctioned preset exists for it (ADR 0058 §4).
        await fixture.preset(zulu);
        await fixture.preset(alpha);
        const formats = new Set([zulu, alpha, unranked]);
        const listedFormats = (await database.listRankedFormats())
          .map(({ id }) => id)
          .filter((id) => formats.has(id));
        assert({
          given: 'an active, two closed and a scheduled season',
          should:
            'list the active and closed ones, newest start first, and never the scheduled one',
          actual: listed,
          expected: [active, newer, older],
        });
        assert({
          given: 'two ranked-eligible formats and one that is not',
          should: 'list only the ranked-eligible ones, by name',
          actual: listedFormats,
          expected: [alpha, zulu],
        });
      } finally {
        await database.close();
      }
    });
  });

  test('reads exactly the asked format, ladder and seasons, with tombstoned names', async () => {
    await withFixture(url, async (fixture) => {
      const database = createDatabase({ url, nextActorId: createId });
      try {
        const formatId = await fixture.format();
        const otherFormat = await fixture.format();
        const first = await season(fixture, 'closed', at(1));
        const second = await season(fixture, 'closed', at(2));
        const third = await season(fixture, 'closed', at(3));
        const [winner, loser] = [await fixture.actor(), await fixture.actor()];
        await fixture.sql.unsafe(
          "update users set deleted_at = now(), username = null, email = null, image = null, name = '' where id = (select user_id from actors where id = $1)",
          [loser],
        );
        /** One debate rated in a scope: both ratings rows and both postings. */
        const rated = async (
          scope: { formatId: string; seasonId: string; ladder: string },
          winnerAfter: number,
        ) => {
          const roundId = await completed(fixture, {
            formatId: scope.formatId,
            affirmative: winner,
            negative: loser,
            outcome: 'affirmative',
          });
          for (const [actorId, after] of [
            [winner, winnerAfter],
            [loser, 3000 - winnerAfter],
          ] as const) {
            await rating(fixture, { actorId, ...scope, rating: after });
            await change(fixture, {
              roundId,
              actorId,
              ...scope,
              before: 1500,
              after,
              occurredAt: at(5),
            });
          }
          return roundId;
        };
        const inFirst = await rated(
          { formatId, seasonId: first, ladder: 'ranked' },
          1516,
        );
        const inSecond = await rated(
          { formatId, seasonId: second, ladder: 'ranked' },
          1520,
        );
        await rated({ formatId, seasonId: third, ladder: 'ranked' }, 1530);
        await rated({ formatId, seasonId: first, ladder: 'quick' }, 1540);
        await rated(
          { formatId: otherFormat, seasonId: first, ladder: 'ranked' },
          1550,
        );

        const read = await database.readStandings({
          formatId,
          ladder: 'ranked',
          seasonIds: [first, second],
        });
        const [winnerName] = (await fixture.sql.unsafe(
          'select username from users where id = (select user_id from actors where id = $1)',
          [winner],
        )) as Array<{ username: string }>;
        const name = winnerName?.username ?? '';
        const bySeasonThenRating = <T extends { seasonId: string }>(
          rows: readonly T[],
          value: (row: T) => number,
        ) =>
          [...rows].sort(
            (a, b) =>
              a.seasonId.localeCompare(b.seasonId) || value(b) - value(a),
          );
        assert({
          given:
            'ratings in two asked seasons, a third season, the quick ladder and another format',
          should:
            'return exactly the ranked rows of that format in the two asked seasons, a tombstoned name as null',
          actual: bySeasonThenRating(read.ratings, (row) => row.rating).map(
            ({ seasonId, actorId, username, rating: value }) => ({
              seasonId,
              actorId,
              username,
              rating: value,
            }),
          ),
          expected: bySeasonThenRating(
            [
              {
                seasonId: first,
                actorId: winner,
                username: name,
                rating: 1516,
              },
              { seasonId: first, actorId: loser, username: null, rating: 1484 },
              {
                seasonId: second,
                actorId: winner,
                username: name,
                rating: 1520,
              },
              {
                seasonId: second,
                actorId: loser,
                username: null,
                rating: 1480,
              },
            ],
            (row) => row.rating,
          ),
        });
        assert({
          given: 'postings in the same five scopes',
          should:
            'return exactly the postings of the asked scope, each with its seat and the debate outcome',
          actual: bySeasonThenRating(
            read.changes,
            (row) => row.ratingAfter,
          ).map(
            ({ seasonId, roundId, actorId, role, outcome, ratingAfter }) => ({
              seasonId,
              roundId,
              actorId,
              role,
              outcome,
              ratingAfter,
            }),
          ),
          expected: bySeasonThenRating(
            [
              {
                seasonId: first,
                roundId: inFirst,
                actorId: winner,
                role: 'affirmative',
                outcome: 'affirmative',
                ratingAfter: 1516,
              },
              {
                seasonId: first,
                roundId: inFirst,
                actorId: loser,
                role: 'negative',
                outcome: 'affirmative',
                ratingAfter: 1484,
              },
              {
                seasonId: second,
                roundId: inSecond,
                actorId: winner,
                role: 'affirmative',
                outcome: 'affirmative',
                ratingAfter: 1520,
              },
              {
                seasonId: second,
                roundId: inSecond,
                actorId: loser,
                role: 'negative',
                outcome: 'affirmative',
                ratingAfter: 1480,
              },
            ],
            (row) => row.ratingAfter,
          ),
        });
      } finally {
        await database.close();
      }
    });
  });
});
