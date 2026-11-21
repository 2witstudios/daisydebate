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
import { loadSampleTournament, sampleInstant } from './tab.test-support';
import { loadLeagueCertifiedRatingInputs } from '../src/tab/league-certified-rating-inputs';
import { readRatingCandidates } from '../src/rating-discovery';
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
      const orphanLeague = createId();
      const orphanSeason = createId();
      const orphanClosed = createId();
      await f.insert('organizations', {
        id: orphanLeague,
        kind: 'league',
        name: 'Spring league',
        handle: orphanLeague,
        owner_user_id: await f.user(),
        league_division: 'youth',
      });
      await f.insert('seasons', {
        id: orphanSeason,
        organization_id: orphanLeague,
        name: 'Spring',
        division: 'youth',
        starts_at: start,
        status: 'active',
      });
      await f.insert('seasons', {
        id: orphanClosed,
        organization_id: orphanLeague,
        name: 'Closed before dates were required',
        division: 'youth',
        starts_at: start,
        status: 'closed',
        updated_at: finish,
      });
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
      const thirdLobby = createId();
      const thirdActor = await f.actor();
      await f.insert('lobbies', {
        id: thirdLobby,
        kind: 'standing',
        owner_organization_id: daisyOrganizationId,
        name: 'Adult practice league',
        handle: thirdLobby,
        age_rule: 'adults',
      });
      const thirdRoom = await f.room(thirdActor, 'freestyle', {
        lobby_id: thirdLobby,
        competition_type: 'ranked',
        preset_version: 1,
        basis_format_id: 'freestyle',
        basis_preset_version: 1,
      });
      const { id: thirdRound } = await f.roundWithCast(
        {
          room_id: thirdRoom,
          competition_type: 'ranked',
          visibility: 'public',
          room_config_snapshot: validConfig,
          format_id: 'freestyle',
          preset_version: 1,
          ladder_id: 'freestyle',
          ladder_division: 'open',
          status: 'completed',
          started_at: start,
          completed_at: finish,
          winning_side: 'affirmative',
        },
        [
          { seat: 'affirmative', actorId: thirdActor },
          { seat: 'negative', actorId: opponent },
        ],
      );
      await f.insert(
        'ratings',
        {
          actor_id: thirdActor,
          season_id: season.open,
          ladder: 'freestyle',
          division: 'open',
          rating: 1620,
          deviation: 270,
          volatility: 0.061,
        },
        'actor_id',
      );
      const thirdPosting = createId();
      await f.insert('rating_changes', {
        id: thirdPosting,
        round_id: thirdRound,
        actor_id: thirdActor,
        ladder: 'freestyle',
        season_id: season.open,
        division: 'open',
        format_id: 'freestyle',
        calculation_version: 'glicko2-v1',
        occurred_at: finish,
        rating_before: 1500,
        rating_after: 1620,
        deviation_before: 350,
        deviation_after: 270,
        volatility_before: 0.06,
        volatility_after: 0.061,
      });
      const league = await client.begin((tx) => loadSampleTournament(tx));
      const laterLobby = createId();
      await f.insert('lobbies', {
        id: laterLobby,
        kind: 'standing',
        owner_organization_id: league.league,
        name: 'Newer league lobby',
        handle: laterLobby,
      });
      const olderLadder = createId();
      const laterLadder = createId();
      const successor = createId();
      const cutoff = sampleInstant(45);
      await client`update seasons set status='closed', ends_at=${cutoff} where id=${league.season}`;
      await f.insert('seasons', {
        id: successor,
        organization_id: league.league,
        name: 'Successor season',
        division: 'open',
        starts_at: cutoff,
        status: 'active',
      });
      const legacyLeagueRounds: string[] = [];
      for (const [lobbyId, ladderId, minutes] of [
        [league.standingLobby, olderLadder, [15, 61, 62]],
        [laterLobby, laterLadder, [16, 17, 63]],
      ] as const) {
        await f.insert('ladders', {
          id: ladderId,
          lobby_id: lobbyId,
          organization_id: league.league,
          name: 'League ladder',
        });
        for (const minute of minutes) {
          const roomId = await f.room(league.debaters[0]!, 'freestyle', {
            lobby_id: lobbyId,
            league_ladder_id: ladderId,
          });
          legacyLeagueRounds.push(
            await f.round({
              room_id: roomId,
              format_id: 'freestyle',
              visibility: 'public',
              room_config_snapshot: validConfig,
              league_ladder_id: ladderId,
              created_at: sampleInstant(minute),
              started_at: sampleInstant(minute + 2),
              completed_at: sampleInstant(minute + 5),
              status: 'completed',
              winning_side: 'affirmative',
            }),
          );
        }
      }
      const data = () =>
        Promise.all([
          client`select id, name, starts_at, ends_at, status from seasons where id in ${client([...Object.values(season), orphanSeason])} order by id`,
          client`select actor_id, season_id, rating, deviation, volatility,version from ratings where actor_id <> ${thirdActor} order by actor_id, season_id`,
          client`select id, round_id, season_id, actor_id, rating_before, rating_after, deviation_before, deviation_after,
        volatility_before, volatility_after, calculation_version, occurred_at from rating_changes where id <> ${thirdPosting} order by id`,
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
      const [relocated] = await client`select s.lobby_id,l.age_rule
        from seasons s join lobbies l on l.id=s.lobby_id where s.id=${orphanSeason}`;
      assert({
        given: 'a league season created before any standing lobby',
        should:
          'give that season a standing lobby in the same league with the historical age rule',
        actual: [relocated?.lobby_id, relocated?.age_rule],
        expected: [orphanLeague, 'under-18'],
      });
      const [closed] =
        await client`select ends_at from seasons where id=${orphanClosed}`;
      assert({
        given:
          'a historical closed season without an end but with a last update',
        should:
          'recover the stored close time so published reads can freeze at it',
        actual: closed?.ends_at,
        expected: finish,
      });
      const certified = await drizzle({ client }).transaction((tx) =>
        loadLeagueCertifiedRatingInputs(tx, {
          organizationId: league.league,
          seasonId: league.season,
        }),
      );
      const [receivingSeason] =
        await client`select lobby_id from seasons where id=${league.season}`;
      const leagueScopes =
        await client`select r.id, r.season_id, r.rating_lobby_id, r.ladder_id, s.name, r.legacy_league_rating
          from rounds r join seasons s on s.id=r.season_id where r.id in ${client(legacyLeagueRounds)}`;
      assert({
        given:
          'an approved sanction and selected Rooms spanning two periods with different primary lobbies',
        should:
          'retain the sanction, choose each Round’s historical period, and flag pre-ledger games for replay',
        actual: {
          lobbyId: receivingSeason?.lobby_id,
          rooms: legacyLeagueRounds.map((id) => {
            const row = leagueScopes.find(
              (item: { id: string }) => item.id === id,
            )!;
            return [
              row.rating_lobby_id,
              row.ladder_id,
              row.name,
              row.season_id === league.season || row.season_id === successor,
              row.legacy_league_rating,
            ];
          }),
          certified: certified.some(({ id }) => id === league.decided),
        },
        expected: {
          lobbyId: laterLobby,
          rooms: [
            [league.standingLobby, olderLadder, 'Sample season', false, true],
            [league.standingLobby, olderLadder, 'Successor season', true, true],
            [league.standingLobby, olderLadder, 'Successor season', true, true],
            [laterLobby, laterLadder, 'Sample season', true, true],
            [laterLobby, laterLadder, 'Sample season', true, true],
            [laterLobby, laterLadder, 'Successor season', false, true],
          ],
          certified: true,
        },
      });
      const [youth] =
        await client`select d.id as ladder, d.lobby_id from ladders d
        join seasons s on s.lobby_id=d.lobby_id where s.id=${season.youth}`;
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
      const [third] =
        await client`select r.rating_lobby_id, r.ladder_id, r.season_id,
        (select rating from ratings where actor_id=${thirdActor} and lobby_id=r.rating_lobby_id) as rating,
        (select rating_after from rating_changes where id=${thirdPosting} and ladder=r.ladder_id and season_id=r.season_id) as posting
        from rounds r where r.id=${thirdRound}`;
      assert({
        given:
          'a historical ranked Round in a third official standing lobby using the old Open keys',
        should:
          'retain its rating and ledger on a separate ladder and copy of the period traced to its Room',
        actual: [
          third?.rating_lobby_id,
          third?.ladder_id !== 'freestyle',
          third?.season_id !== season.open,
          third?.rating,
          third?.posting,
        ],
        expected: [thirdLobby, true, true, 1620, 1620],
      });
      const db = standingsOperations({ database: drizzle({ client }) });
      const legacyFirst = await readRatingCandidates(drizzle({ client }), {
        limit: 3,
      });
      const legacyRest = await readRatingCandidates(drizzle({ client }), {
        limit: 3,
        afterId: legacyFirst.at(-1)!.roundId,
      });
      assert({
        given:
          'legacy league Rounds spread across two seasons and two standing lobbies',
        should:
          'scan their completion order faithfully across a cursor boundary',
        actual: [...legacyFirst, ...legacyRest].map(({ roundId }) => roundId),
        expected: [0, 3, 4, 1, 2, 5].map((index) => legacyLeagueRounds[index]),
      });
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
            await tx`update ratings set rating = 1700 where lobby_id=${thirdLobby} returning actor_id`
          ).length,
        })),
        sqlStateOf(() =>
          asOpen(
            (tx) => tx`insert into ratings
          (actor_id,ladder,lobby_id,season_id,rating,deviation,volatility)
          values (${opponent},${third!.ladder_id},${thirdLobby},${third!.season_id},1500,350,0.06)`,
          ),
        ),
      ]);
      assert({
        given:
          'the web database role scoped to Open and a valid rating pool in a third lobby',
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
