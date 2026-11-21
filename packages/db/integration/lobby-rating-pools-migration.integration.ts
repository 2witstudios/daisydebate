import { afterAll } from 'bun:test';
import { SQL } from 'bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { standingsOperations } from '../src/standings';
import { daisyOrganizationId, publicLobbyId } from '../src/daisy-reference';
import { Fixture, rejectedBy, sqlStateOf } from './constraint-helpers';
import { validConfig } from './round-fixtures';
import { loadSampleTournament } from './tab.test-support';
import { loadLeagueCertifiedRatingInputs } from '../src/tab/league-certified-rating-inputs';
import { readRatingCandidates } from '../src/rating-discovery';
import { launchedRoundRows } from '../src/launched-round-read';
import { memberProfileReadOperations } from '../src/member-profile-reads';
import {
  ddlTimeoutMs,
  scratchDatabase,
} from './scratch-migrations.test-support';

setupRitewayBun();
const scratch = scratchDatabase(
  requireTestServices(process.env).databaseUrl,
  'll2',
);
const migration = '20261121082420_ll_2_lobby_rating_pools';
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
      const league = await client.begin((tx) =>
        loadSampleTournament(tx, { beforeTournamentEligibility: true }),
      );
      const ladder = createId();
      await f.insert('ladders', {
        id: ladder,
        lobby_id: league.standingLobby,
        organization_id: league.league,
        name: 'League ladder',
      });
      const leagueRoom = await f.room(league.debaters[0]!, 'freestyle', {
        lobby_id: league.standingLobby,
        league_ladder_id: ladder,
      });
      const unposted = await f.round({
        room_id: leagueRoom,
        format_id: 'freestyle',
        visibility: 'public',
        room_config_snapshot: validConfig,
        league_ladder_id: ladder,
        started_at: start,
        completed_at: finish,
        status: 'completed',
        winning_side: 'affirmative',
      });
      const [youthLobby] =
        await client`select id from lobbies where owner_organization_id=${daisyOrganizationId} and age_rule='under-18'`;
      const youthRoom = await f.room(actor.youth, 'freestyle', {
        lobby_id: youthLobby!.id,
        competition_type: 'ranked',
        preset_version: 1,
        basis_format_id: 'freestyle',
        basis_preset_version: 1,
      });
      const { id: unpostedYouth } = await f.roundWithCast(
        {
          room_id: youthRoom,
          competition_type: 'ranked',
          format_id: 'freestyle',
          preset_version: 1,
          ladder_id: 'freestyle',
          ladder_division: 'youth',
          visibility: 'public',
          room_config_snapshot: validConfig,
          status: 'completed',
          started_at: start,
          completed_at: finish,
          winning_side: 'affirmative',
        },
        [
          { seat: 'affirmative', actorId: actor.youth },
          { seat: 'negative', actorId: opponent },
        ],
      );
      const data = () =>
        Promise.all([
          client`select id, name, starts_at, ends_at, status from seasons where id in ${client([...Object.values(season), league.season])} order by id`,
          client`select actor_id, season_id, rating, deviation, volatility,version from ratings order by actor_id, season_id`,
          client`select id, round_id, season_id, actor_id, rating_before, rating_after, deviation_before, deviation_after,
        volatility_before, volatility_after, calculation_version, occurred_at from rating_changes order by id`,
        ]);
      const before = await data();
      const ambiguousLobby = createId();
      await f.insert('lobbies', {
        id: ambiguousLobby,
        kind: 'standing',
        owner_organization_id: league.league,
        name: 'Second standing lobby',
        handle: ambiguousLobby,
      });
      const rejected = await scratch
        .migrate((name) => name <= migration)
        .then(
          () => false,
          (error: Error) =>
            String(error.cause ?? error).includes(
              'Rating pool adoption requires explicit',
            ),
        );
      assert({
        given: 'an old season with two possible standing lobbies',
        should: 'stop the upgrade and retain the stored competitive data',
        actual: [rejected, (await data()).map((rows) => Array.from(rows))],
        expected: [true, before.map((rows) => Array.from(rows))],
      });
      await client`delete from lobbies where id=${ambiguousLobby}`;
      await scratch.migrate((name) => name <= migration);
      assert({
        given:
          'active Open and Youth seasons and one closed season with posted rounds',
        should: 'keep every historical season and Glicko state and posting',
        actual: (await data()).map((rows) => Array.from(rows)),
        expected: before.map((rows) => Array.from(rows)),
      });
      const certified = await drizzle({ client }).transaction((tx) =>
        loadLeagueCertifiedRatingInputs(tx, {
          organizationId: league.league,
          seasonId: league.season,
        }),
      );
      const [receivingSeason] =
        await client`select lobby_id from seasons where id=${league.season}`;
      const [oldRound] =
        await client`select season_id, ladder_id, rating_lobby_id from rounds where id=${unposted}`;
      const candidates = await readRatingCandidates(drizzle({ client }), {
        limit: 100,
      });
      const database = drizzle({ client });
      const [youthUser] =
        await client`select username from users u join actors a on a.user_id=u.id where a.id=${actor.youth}`;
      const launched = await database.transaction((tx) =>
        launchedRoundRows(tx, unpostedYouth),
      );
      const history = await memberProfileReadOperations({
        database,
      }).readMemberProfile({
        username: youthUser!.username,
        caller: null,
        decide: () => 'public',
        before: null,
        limit: 10,
        clock: { now: '2099-01-01T00:00:00.000Z', rankedDelaySeconds: 0 },
      });
      const youthLabel = { style: 'freestyle', division: 'youth' };
      assert({
        given:
          'a completed Youth ranked Round whose predecessor never posted a rating',
        should:
          'preserve its Youth label in the launched and member history reads and exclude it from settlement',
        actual: [
          launched.ladder,
          launched.ratingScope,
          history?.rows.find((row) => row.roundId === unpostedYouth)?.ladder,
          candidates.some(({ roundId }) => roundId === unpostedYouth),
        ],
        expected: [youthLabel, null, youthLabel, false],
      });
      const [inventory] = await client`select
        (select count(*)::int from ladders where organization_id=${league.league}) as ladders,
        (select count(*)::int from seasons where organization_id=${league.league}) as seasons`;
      assert({
        given:
          'a league with one standing lobby, one season, an approved sanction and a completed old Room without postings',
        should:
          'retain the real receiving season and certification without making the old Room rateable',
        actual: [
          receivingSeason?.lobby_id,
          certified.some(({ id }) => id === league.decided),
          oldRound,
          candidates.some(({ roundId }) => roundId === unposted),
          inventory,
        ],
        expected: [
          league.standingLobby,
          true,
          { season_id: null, ladder_id: null, rating_lobby_id: null },
          false,
          { ladders: 1, seasons: 1 },
        ],
      });
      const [youth] =
        await client`select d.id as ladder, d.lobby_id from ladders d
        join seasons s on s.lobby_id=d.lobby_id where s.id=${season.youth}`;
      const scopes =
        await client`select id, ladder_id, rating_lobby_id, season_id, standing_age_rule from rounds where id in ${client(roundIds)}`;
      assert({
        given: 'posted Rounds whose timestamps disagree with their ledger',
        should:
          'freeze each posting’s original season and its own lobby ladder',
        actual: roundIds.map((id) => {
          const row = scopes.find((scope: { id: string }) => scope.id === id)!;
          return [
            row.ladder_id,
            row.rating_lobby_id,
            row.season_id,
            row.standing_age_rule,
          ];
        }),
        expected: [
          ['freestyle', publicLobbyId, season.open, 'adults'],
          [youth!.ladder, youth!.lobby_id, season.youth, 'under-18'],
          ['freestyle', publicLobbyId, season.closed, 'adults'],
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
      const asOpen = <T>(work: (tx: SQL) => Promise<T>) =>
        client.begin(async (tx) => {
          await tx`set local role daisy_web`;
          await tx`select set_config('daisy.lobby_scope',${publicLobbyId},true)`;
          return work(tx);
        });
      const [isolated, denied] = await Promise.all([
        asOpen(async (tx) => ({
          ratings: (await tx`select distinct lobby_id from ratings`).map(
            (row: { lobby_id: string }) => row.lobby_id,
          ),
          ledger: (await tx`select distinct lobby_id from rating_changes`).map(
            (row: { lobby_id: string }) => row.lobby_id,
          ),
          updated: (
            await tx`update ratings set rating = 1700 where lobby_id=${youth!.lobby_id} returning actor_id`
          ).length,
        })),
        sqlStateOf(() =>
          asOpen(
            (tx) => tx`insert into ratings
          (actor_id,ladder,lobby_id,season_id,rating,deviation,volatility)
          values (${opponent},${youth!.ladder},${youth!.lobby_id},${season.youth},1500,350,0.06)`,
          ),
        ),
      ]);
      assert({
        given: 'the web database role scoped to Open and the Youth rating pool',
        should: 'read Open only and refuse writes to the other pool',
        actual: { ...isolated, denied },
        expected: {
          ratings: [publicLobbyId],
          ledger: [publicLobbyId],
          updated: 0,
          denied: '42501',
        },
      });
    } finally {
      await client.close();
    }
  },
  ddlTimeoutMs,
);
