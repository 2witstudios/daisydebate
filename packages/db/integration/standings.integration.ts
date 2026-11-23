import { daisyOrganizationId, publicLobbyId } from '../src/daisy-reference';
import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { drizzle } from 'drizzle-orm/bun-sql';
import { sql } from 'drizzle-orm';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createDatabase } from '../src';
import { standingsOperations } from '../src/standings';
import { withFixture } from './constraint-helpers';
import { at, change, completed, rating, season } from './standings-fixtures';

const affirmativeWin = { kind: 'winner', side: 'affirmative' } as const;

setupRitewayBun();

const { databaseUrl: url } = requireTestServices(process.env);
const scope = {
  ladderId: 'freestyle',
  lobbyId: publicLobbyId,
  clock: { now: '2026-11-02T00:00:00.000Z', rankedDelaySeconds: 0 },
} as const;

test('standings opens one actual read-only repeatable snapshot only when there are seasons', async () => {
  await withFixture(url, async (fixture) => {
    const db = drizzle({ client: fixture.sql });
    const transaction = db.transaction.bind(db);
    const settings: unknown[] = [];
    db.transaction = (work, config) =>
      transaction(async (tx) => {
        const [setting] =
          await tx.execute(sql`select current_setting('transaction_isolation') as isolation,
        current_setting('transaction_read_only') as read_only`);
        settings.push(setting);
        return work(tx);
      }, config);
    const standings = standingsOperations({
      database: db,
      eventSink: undefined,
    });
    const empty = await standings.readStandings({ ...scope, seasonIds: [] });
    const before = settings.length;
    await standings.readStandings({ ...scope, seasonIds: [createId()] });
    assert({
      given: 'an empty request followed by a request naming a season',
      should:
        'skip the empty snapshot and use one read-only repeatable snapshot for both reads',
      actual: [empty, before, settings],
      expected: [
        { ratings: [], changes: [] },
        0,
        [{ isolation: 'repeatable read', read_only: 'on' }],
      ],
    });
  });
});

test('standings refuses a posting with an invalid two-sided outcome', async () => {
  await withFixture(url, async (fixture) => {
    const seasonId = await season(fixture, 'closed', at(1));
    const affirmative = await fixture.actor();
    const negative = await fixture.actor();
    const roundId = await completed(fixture, {
      formatId: 'freestyle',
      affirmative,
      negative,
      outcome: 'affirmative',
      seasonId,
      visibility: 'public',
    });
    await change(fixture, {
      seasonId,
      roundId,
      actorId: affirmative,
      formatId: 'freestyle',
      ladder: 'freestyle',
      before: 1500,
      after: 1516,
      occurredAt: at(5),
    });
    const standings = standingsOperations({
      database: drizzle({ client: fixture.sql }),
      eventSink: undefined,
    });
    for (const outcome of ['other_side', null]) {
      await fixture.sql`update rounds set winning_side = ${outcome} where id = ${roundId}`;
      await assertRejects({
        given: `a persisted posting with outcome ${outcome ?? 'missing'}`,
        should: 'refuse as an internal error without inventing a result',
        actual: () =>
          standings.readStandings({ ...scope, seasonIds: [seasonId] }),
        code: 'INTERNAL',
      });
    }
  });
});

describe('standings reads (RATE-1.4.1)', () => {
  test('lists active and closed seasons newest first, and ranked formats by name', async () => {
    await withFixture(url, async (fixture) => {
      const database = createDatabase({ url, nextActorId: createId });
      try {
        const older = await season(fixture, 'closed', at(1));
        const newer = await season(fixture, 'closed', at(3));
        const active = await season(fixture, 'active', at(7));
        const mine = new Set([older, newer, active]);
        const listed = (await database.listLadderSeasons())
          .map(({ id }) => id)
          .filter((id) => mine.has(id));
        const listedFormats = (await database.listRankedFormats())
          .map(({ id }) => id)
          .sort();
        assert({
          given: 'an active and two closed seasons',
          should: 'list them newest start first',
          actual: listed,
          expected: [active, newer, older],
        });
        assert({
          given: 'the seeded catalog, whose one standard is ranked-eligible',
          should: 'list only Freestyle (ADR 0142)',
          actual: listedFormats,
          expected: ['freestyle'],
        });
      } finally {
        await database.close();
      }
    });
  });

  test('the Open ladder read with a Youth season returns the Open posting alone', async () => {
    await withFixture(url, async (fixture) => {
      const database = createDatabase({ url, nextActorId: createId });
      try {
        const [youth] =
          (await fixture.sql`select d.id as ladder, d.lobby_id as lobby
          from ladders d join lobbies l on l.id = d.lobby_id
          where l.owner_organization_id = ${daisyOrganizationId}
            and l.kind = 'standing' and l.age_rule = 'under-18'
          order by d.created_at, d.id limit 1`) as {
            ladder: string;
            lobby: string;
          }[];
        const openSeason = await season(fixture, 'closed', at(1));
        const youthSeason = createId();
        await fixture.insert('seasons', {
          id: youthSeason,
          organization_id: daisyOrganizationId,
          lobby_id: youth!.lobby,
          name: 'Season youth',
          starts_at: at(1),
          ends_at: at(2),
          status: 'closed',
        });
        const [winner, loser] = [await fixture.actor(), await fixture.actor()];
        /** One rated debate in a pool: both postings. */
        const posted = async (pool: {
          seasonId: string;
          ladder: string;
          lobby: string;
        }) => {
          const roundId = await completed(fixture, {
            formatId: 'freestyle',
            affirmative: winner,
            negative: loser,
            outcome: 'affirmative',
            seasonId: pool.seasonId,
            visibility: 'public',
            pool,
          });
          for (const [actorId, after] of [
            [winner, 1516],
            [loser, 1484],
          ] as const)
            await fixture.insert('rating_changes', {
              id: createId(),
              round_id: roundId,
              actor_id: actorId,
              format_id: 'freestyle',
              season_id: pool.seasonId,
              ladder: pool.ladder,
              lobby_id: pool.lobby,
              rating_before: 1500,
              rating_after: after,
              deviation_before: 350,
              deviation_after: 300,
              volatility_before: 0.06,
              volatility_after: 0.06,
              calculation_version: 'glicko2-v1',
              occurred_at: at(5),
            });
          return roundId;
        };
        await posted({
          seasonId: openSeason,
          ladder: 'freestyle',
          lobby: publicLobbyId,
        });
        await posted({ seasonId: youthSeason, ...youth! });
        const read = await database.readStandings({
          ladderId: 'freestyle',
          lobbyId: publicLobbyId,
          seasonIds: [youthSeason, openSeason],
          clock: { now: '2099-01-01T00:00:00.000Z', rankedDelaySeconds: 0 },
        });
        assert({
          given:
            'postings in an Open and a Youth season, and the Open ladder queried with both season ids',
          should: 'return the Open postings alone',
          actual: [...new Set(read.changes.map(({ seasonId }) => seasonId))],
          expected: [openSeason],
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
        const formatId = 'freestyle';
        const first = await season(fixture, 'closed', at(1));
        const second = await season(fixture, 'closed', at(2));
        const third = await season(fixture, 'closed', at(3));
        const [winner, loser] = [await fixture.actor(), await fixture.actor()];
        await fixture.sql.unsafe(
          "update users set deleted_at = now(), email = null, image = null, name = '' where id = (select user_id from actors where id = $1)",
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
            seasonId: scope.seasonId,
            visibility: 'public',
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
          { formatId, seasonId: first, ladder: 'freestyle' },
          1516,
        );
        const inSecond = await rated(
          { formatId, seasonId: second, ladder: 'freestyle' },
          1520,
        );
        await rated({ formatId, seasonId: third, ladder: 'freestyle' }, 1530);

        const read = await database.readStandings({
          ladderId: 'freestyle',
          lobbyId: publicLobbyId,
          seasonIds: [first, second],
          clock: { now: new Date().toISOString(), rankedDelaySeconds: 0 },
        });
        const [winnerName] = (await fixture.sql.unsafe(
          'select username from users where id = (select user_id from actors where id = $1)',
          [winner],
        )) as Array<{ username: string }>;
        const name = winnerName?.username ?? '';
        const [loserName] = (await fixture.sql.unsafe(
          'select username from users where id = (select user_id from actors where id = $1)',
          [loser],
        )) as Array<{ username: string }>;
        const closedName = loserName?.username ?? '';
        const bySeasonThenRating = <T extends { seasonId: string }>(
          rows: readonly T[],
          value: (row: T) => number,
        ) =>
          [...rows].sort(
            (a, b) =>
              a.seasonId.localeCompare(b.seasonId) || value(b) - value(a),
          );
        assert({
          given: 'ratings in two asked seasons and a third season',
          should:
            'return exactly the ranked rows of that format in the two asked seasons, a closed account by name and marked closed',
          actual: bySeasonThenRating(read.ratings, (row) => row.rating).map(
            ({
              seasonId,
              actorId,
              username,
              accountClosed,
              rating: value,
            }) => ({
              seasonId,
              actorId,
              username,
              accountClosed,
              rating: value,
            }),
          ),
          expected: bySeasonThenRating(
            [
              {
                seasonId: first,
                actorId: winner,
                username: name,
                accountClosed: false,
                rating: 1516,
              },
              {
                seasonId: first,
                actorId: loser,
                username: closedName,
                accountClosed: true,
                rating: 1484,
              },
              {
                seasonId: second,
                actorId: winner,
                username: name,
                accountClosed: false,
                rating: 1520,
              },
              {
                seasonId: second,
                actorId: loser,
                username: closedName,
                accountClosed: true,
                rating: 1480,
              },
            ],
            (row) => row.rating,
          ),
        });
        assert({
          given: 'postings in the same five scopes',
          should:
            'return exactly the postings of the asked scope, each with its side and the winning side',
          actual: bySeasonThenRating(
            read.changes,
            (row) => row.ratingAfter,
          ).map(
            ({
              seasonId,
              roundId,
              actorId,
              side,
              outcome,
              ratingAfter,
              occurredAt,
            }) => ({
              seasonId,
              roundId,
              actorId,
              side: side as string,
              outcome,
              ratingAfter,
              occurredAt,
            }),
          ),
          expected: bySeasonThenRating(
            [
              {
                seasonId: first,
                roundId: inFirst,
                actorId: winner,
                side: 'affirmative',
                outcome: affirmativeWin,
                ratingAfter: 1516,
                occurredAt: at(5).toISOString(),
              },
              {
                seasonId: first,
                roundId: inFirst,
                actorId: loser,
                side: 'negative',
                outcome: affirmativeWin,
                ratingAfter: 1484,
                occurredAt: at(5).toISOString(),
              },
              {
                seasonId: second,
                roundId: inSecond,
                actorId: winner,
                side: 'affirmative',
                outcome: affirmativeWin,
                ratingAfter: 1520,
                occurredAt: at(5).toISOString(),
              },
              {
                seasonId: second,
                roundId: inSecond,
                actorId: loser,
                side: 'negative',
                outcome: affirmativeWin,
                ratingAfter: 1480,
                occurredAt: at(5).toISOString(),
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
