import { afterAll } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { SQL } from 'bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { standingsOperations } from '../src/standings';
import { daisyOrganizationId, publicLobbyId } from '../src/daisy-reference';
import { Fixture, rejectedBy } from './constraint-helpers';
import {
  ddlTimeoutMs,
  scratchDatabase,
} from './scratch-migrations.test-support';

setupRitewayBun();
const scratch = scratchDatabase(
  requireTestServices(process.env).databaseUrl,
  'll2',
);
const migration = (
  await readdir(new URL('../migrations', import.meta.url))
).find((name) => name.endsWith('_ll_2_lobby_rating_pools'))!;
afterAll(() => scratch.drop());

test(
  'lobby rating pool migration preserves seasons, projections and ledger',
  async () => {
    await scratch.create();
    await scratch.migrate((name) => name < migration);
    const client = new SQL(scratch.url);
    const f = new Fixture(client);
    const start = new Date('2026-09-01T12:00:00.000Z');
    const finish = new Date('2026-09-01T12:50:00.000Z');
    try {
      const season = {
        open: createId(),
        youth: createId(),
        closed: createId(),
      };
      const actor = { open: await f.actor(), youth: await f.actor() };
      const opponent = await f.actor();
      const oldSeason = {
        organization_id: daisyOrganizationId,
        name: 'Season 1',
        starts_at: start,
      };
      for (const division of ['open', 'youth'] as const) {
        await f.insert('seasons', {
          ...oldSeason,
          id: season[division],
          division,
          status: 'active',
        });
      }
      await f.insert('seasons', {
        ...oldSeason,
        id: season.closed,
        division: 'open',
        status: 'closed',
        starts_at: new Date('2026-08-01'),
        ends_at: start,
      });
      const roundIds = [];
      for (const [division, seasonId] of [
        ['open', season.open],
        ['youth', season.youth],
        ['open', season.closed],
      ] as const) {
        const { id: round } = await f.roundWithCast(
          {
            competition_type: 'ranked',
            format_id: 'freestyle',
            preset_version: 1,
            ladder_id: 'freestyle',
            ladder_division: division,
            status: 'completed',
            started_at: start,
            completed_at: finish,
            winning_side: 'affirmative',
          },
          [
            { seat: 'affirmative', actorId: actor[division] },
            { seat: 'negative', actorId: opponent },
          ],
        );
        roundIds.push(round);
        await f.insert(
          'ratings',
          {
            actor_id: actor[division],
            season_id: seasonId,
            ladder: 'freestyle',
            division,
            rating: 1600.25,
            deviation: 250.5,
            volatility: 0.061,
          },
          'actor_id',
        );
        await f.insert('rating_changes', {
          id: createId(),
          round_id: round,
          actor_id: actor[division],
          ladder: 'freestyle',
          season_id: seasonId,
          division,
          format_id: 'freestyle',
          calculation_version: 'glicko2-v1',
          occurred_at: finish,
          rating_before: 1500,
          rating_after: 1600.25,
          deviation_before: 350,
          deviation_after: 250.5,
          volatility_before: 0.06,
          volatility_after: 0.061,
        });
      }
      const data = () =>
        Promise.all([
          client`select id, name, starts_at, ends_at, status from seasons order by id`,
          client`select actor_id, season_id, rating, deviation, volatility,version from ratings order by actor_id, season_id`,
          client`select id, round_id, season_id, actor_id, rating_before, rating_after, deviation_before, deviation_after,
        volatility_before, volatility_after, calculation_version, occurred_at from rating_changes order by id`,
        ]);
      const before = await data();
      await scratch.migrate((name) => name <= migration);
      assert({
        given:
          'active Open and Youth seasons and one closed season with posted rounds',
        should: 'keep every historical season and Glicko state and posting',
        actual: (await data()).map((rows) => Array.from(rows)),
        expected: before.map((rows) => Array.from(rows)),
      });
      const [youth] =
        await client`select id as ladder, lobby_id from ladders where lobby_id <> ${publicLobbyId}`;
      const scopes =
        await client`select id, ladder_id, rating_lobby_id, season_id from rounds where id in ${client(roundIds)}`;
      assert({
        given: 'posted Rounds whose timestamps disagree with their ledger',
        should:
          'freeze each posting’s original season and its own lobby ladder',
        actual: roundIds.map((id) => {
          const row = scopes.find((scope: { id: string }) => scope.id === id)!;
          return [row.ladder_id, row.rating_lobby_id, row.season_id];
        }),
        expected: [
          ['freestyle', publicLobbyId, season.open],
          [youth!.ladder, youth!.lobby_id, season.youth],
          ['freestyle', publicLobbyId, season.closed],
        ],
      });
      const db = standingsOperations({ database: drizzle({ client }) });
      const open = await db.readStandings({
        ladderId: 'freestyle',
        lobbyId: publicLobbyId,
        seasonIds: [season.youth, season.closed],
        clock: { now: '2099-01-01T00:00:00.000Z', rankedDelaySeconds: 0 },
        revealRoundId: roundIds[2]!,
      });
      assert({
        given:
          'the Open ladder queried with a Youth season and an Open historical season',
        should: 'return the Open posting alone',
        actual: open.changes.map(({ seasonId }) => seasonId),
        expected: [season.closed],
      });
      assert({
        given: 'a second active season and a rating from a foreign ladder',
        should: 'refuse both at the database boundary',
        actual: [
          await rejectedBy(
            () => client`insert into seasons
          (id, name, organization_id, lobby_id, status, starts_at)
          values (${createId()},'Duplicate',${daisyOrganizationId},${publicLobbyId},'active',${start})`,
          ),
          await rejectedBy(
            () => client`insert into ratings
          (actor_id,ladder,lobby_id,season_id,rating,deviation,volatility)
          values (${opponent},${youth!.ladder},${publicLobbyId},${season.open},1500,350,0.06)`,
          ),
        ],
        expected: ['seasons_single_active', 'ratings_ladder_lobby_fk'],
      });
    } finally {
      await client.close();
    }
  },
  ddlTimeoutMs,
);
