import { leagueRatingCorrection } from './league-rating-correction.test-support';
import {
  leagueRoomRating,
  openLeagueRatingSeason,
} from './league-room-rating.test-support';
import { requireTestServices } from '@daisy/config';
import {
  scratchDatabase,
  committingRuntimeTestDatabase,
} from '@daisy/db/testing';
import { createId } from '@paralleldrive/cuid2';
import { SQL } from 'bun';
import { setupRitewayBun, test } from 'riteway/bun';
import {
  createBots,
  scriptClock,
  type World,
} from './tab-tournament.test-support';
import { organizationStage } from './tab-tournament-organization.test-support';
import { leagueAdministrationStage } from './tab-tournament-league-administration.test-support';
import { leagueConfigurationStage } from './tab-tournament-league-configuration.test-support';
import { setupStage } from './tab-tournament-setup.test-support';
import { entryEnrollmentStage } from './tab-tournament-entry-enrollment.test-support';
import { judgeRegistrationStage } from './tab-tournament-judge-registration.test-support';
import { draftDrawStage } from './tab-tournament-draw-draft.test-support';
import { publishDrawStage } from './tab-tournament-publication.test-support';
import { officiatingStage } from './tab-tournament-officiating.test-support';
import { resultsStage } from './tab-tournament-results.test-support';
import { standingsStage } from './tab-tournament-standings.test-support';
import { completionStage } from './tab-tournament-completion.test-support';
import { ratingStage } from './tab-tournament-rating.test-support';
import { assert } from 'riteway/bun';
import { authorize } from '@daisy/auth/authorization';
import { createTabStore } from '@daisy/db/tab';
import { rateDebate, ratingPolicy } from '@daisy/debate-engine';
import { winnerOutcome } from '@daisy/protocol';
import { lobbyAdministrationCommand } from '../src/features/tab/operations/lobby-administration';
import { as } from './tab-tournament-organization-wiring.test-support';
import { withRoomRuntime } from './room-runtime.test-support';
import { readLadder } from '../src/features/leaderboard/read-leaderboard';
import { replayPublishedStandings } from '../src/features/ratings/replay-published-standings';
import { spectatorClockAt } from '../src/features/spectating/spectator-clock';
import { createRatingSweep } from '../src/features/ratings/sweep';
import { readLeagueLadder } from '../src/features/ratings/read-league-ladder';
import { resolveSetting, roomChain } from '@daisy/protocol/setting-resolution';
import { settingCommand } from '../src/features/tab/operations/settings';
import { releaseCommand } from '../src/features/tab/operations/release-command';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
test('league ratings replay certified inputs and freeze the later tournament seed', async () => {
  const scratch = scratchDatabase(databaseUrl, 'leaguerating');
  await scratch.create();
  const owner = new SQL(scratch.url, { max: 4 });
  try {
    await scratch.migrate(() => true);
    const bots = await createBots(owner, [
      'Director',
      'Staff',
      'Coach',
      'Judge A',
      'Judge B',
      'Judge C',
      'Debater 1',
      'Debater 2',
      'Debater 3',
      'Debater 4',
    ]);
    const world: World = {
      database: committingRuntimeTestDatabase(owner),
      sql: owner,
      runtimeDatabaseUrl: scratch.url,
      clock: scriptClock(Date.now() - 60 * 60_000),
      bots: Object.fromEntries(bots.map((bot) => [bot.name, bot])),
      made: new Map(),
    };
    for (const run of [
      organizationStage,
      leagueAdministrationStage,
      leagueConfigurationStage,
      setupStage,
      entryEnrollmentStage,
      judgeRegistrationStage,
      draftDrawStage,
      publishDrawStage,
      officiatingStage,
      resultsStage,
      standingsStage,
      completionStage,
    ]) {
      await run(world);
      if (run === setupStage) await keepSourcePublicReleasesManual(world);
    }
    const priorSeasonId = await openLeagueRatingSeason(world);
    await leagueRoomRating(world, 2);
    const closed = await lobbyAdministrationCommand({
      store: createTabStore(world.database),
      authorize,
      now: world.clock.now,
      newId: createId,
    })(as(world.bots.Director!), {
      version: 1,
      commandId: createId(),
      expected: { season: 1 },
      command: { type: 'close-season', seasonId: priorSeasonId },
    });
    if (closed.kind !== 'accepted')
      throw new Error(`Close rating season: ${JSON.stringify(closed)}`);
    const seasonId = await openLeagueRatingSeason(world);
    const ratedInNext = await leagueRoomRating(world, 2);
    const posted =
      await owner`select distinct season_id,rating_before from rating_changes where round_id=${ratedInNext}`;
    assert({
      given:
        'returning competitors from the last season who finish a rated Round in the next',
      should: 'post once per participant at the next season’s initial rating',
      actual: [...posted],
      expected: [
        { season_id: seasonId, rating_before: ratingPolicy.initial.rating },
      ],
    });
    // Sanction commands belong to the season proof. This is the exact durable
    // published input the rating consumer receives from that separate owner.
    await owner`insert into sanctions (id,organization_id,lobby_id,event_id,season_id,template_id,status,decided_at) values (${createId()},${world.made.get('league')!},${world.made.get('tournament-lobby')!},${world.made.get('event')!},${seasonId},${world.made.get('league-template')!},'approved',${world.clock.now()})`;
    await ratingStage(world);
    await leagueRatingCorrection(world);
    await publicRatingProgression(world);
    await legacyRatingRecovery(world, seasonId);
  } finally {
    await owner.close();
    await scratch.drop();
  }
}, 180_000);

async function keepSourcePublicReleasesManual(world: World) {
  const lobbyId = world.made.get('tournament-lobby')!;
  const set = settingCommand({
    store: createTabStore(world.database),
    authorize,
    now: world.clock.now,
    newId: createId,
  });
  for (const thing of ['posting', 'decision'] as const) {
    const [lobby] =
      await world.sql`select settings_version from lobbies where id=${lobbyId}`;
    const result = await set(as(world.bots.Director!), {
      version: 1,
      commandId: createId(),
      expected: { settings: Number(lobby!.settings_version) },
      command: {
        type: 'set-setting',
        scope: { kind: 'lobby', id: lobbyId },
        key: `audience.${thing}`,
        hold: 'default',
        value: {
          responsible_adults: 'at_once',
          competitors: 'at_once',
          participants: 'at_once',
          link: 'at_once',
          public: 'manual',
        },
      },
    });
    if (result.kind !== 'accepted') throw new Error(JSON.stringify(result));
  }
}

async function publicRatingProgression(world: World) {
  const organizationId = world.made.get('league')!;
  const lobbyId = world.made.get('standing-lobby')!;
  const tournamentId = world.made.get('tournament-lobby')!;
  await world.sql`update organizations set official=true where id=${organizationId}`;
  await world.sql`update settings set value=${{ value: 'public' }}
    where organization_id=${organizationId} and scope_kind='organization' and key='room.visibility'`;
  const publicRound = await leagueRoomRating(world, 2, 'public');
  const tab = createTabStore(world.database);
  const [lobby] =
    await world.sql`select settings_version from lobbies where id=${lobbyId}`;
  const allowPublic = await settingCommand({
    store: tab,
    authorize,
    now: world.clock.now,
    newId: createId,
  })(as(world.bots.Director!), {
    version: 1,
    commandId: createId(),
    expected: { settings: Number(lobby!.settings_version) },
    command: {
      type: 'set-setting',
      scope: { kind: 'lobby', id: lobbyId },
      key: 'audience.posting',
      hold: 'default',
      value: {
        ...resolveSetting(
          'audience.posting',
          roomChain({ organizationId, lobbyId, templateId: null }),
          [],
        ).value,
        link: 'at_once',
        public: 'at_once',
      },
    },
  });
  if (allowPublic.kind !== 'accepted')
    throw new Error(JSON.stringify(allowPublic));
  const league = readLeagueLadder({ store: tab, authorize });
  const counts = async () =>
    Promise.all(
      ['Director', 'Coach', 'Judge A'].map(async (name) => {
        const ladder = await league(as(world.bots[name]!), { lobbyId });
        return ladder
          ? actorIds.map((actorId) => {
              const line = ladder.lines.find((row) => row.actorId === actorId);
              return line ? line.wins + line.losses : 0;
            })
          : null;
      }),
    );
  const actorIds = ['Debater 1', 'Debater 2'].map(
    (name) => world.bots[name]!.actorId,
  );
  const now = new Date(Date.now() + 60_000).toISOString();
  const first = { state: ratingPolicy.initial, lastRatedAt: null };
  const firstPublicMatch = rateDebate({
    affirmative: first,
    negative: first,
    occurredAt: now,
    outcome: winnerOutcome('negative'),
  });
  await withRoomRuntime(
    async ({ store }) => {
      const read = async () => {
        const board = await readLadder(store, {
          lobbyId,
          seasonId: null,
          now,
          username: null,
          ladder: { style: 'freestyle', division: 'open' },
        });
        const cards = await store.readMemberCardRatings(
          actorIds,
          spectatorClockAt(now),
          replayPublishedStandings,
        );
        return actorIds.map((actorId) => {
          const row = board?.data.entries.find(({ id }) => id === actorId);
          const card = cards.find(
            (r) => r.lobbyId === lobbyId && r.actorId === actorId,
          );
          return {
            games: row?.played ?? 0,
            rating: row ? Math.round(row.rating) : null,
            card: card ? Math.round(card.rating) : null,
          };
        });
      };
      const before = await read();
      const [hostBefore, memberBefore, outsiderBefore] = await counts();
      assert({
        given:
          'a second official lobby with a public Room after a hidden game and no public tournament release',
        should:
          'publish both sides from their public game alone and show the same rating on their cards',
        actual: before,
        expected: [firstPublicMatch.affirmative, firstPublicMatch.negative].map(
          ({ after }) => ({
            games: 1,
            rating: Math.round(after.rating),
            card: Math.round(after.rating),
          }),
        ),
      });
      assert({
        given:
          'an approved certification without source posting and decision releases',
        should:
          'show it to the source host and leave the member and outsider with only public Room history',
        actual: [hostBefore?.some((n) => n > 2), memberBefore, outsiderBefore],
        expected: [true, [1, 1], [1, 1]],
      });
      const rounds =
        await world.sql`select distinct r.tab_round_id,r.event_id from results r
        join certification_results cr on cr.result_id=r.id
        where r.lobby_id=${tournamentId} order by r.tab_round_id`;
      const send = releaseCommand({ store: tab, authorize, newId: createId });
      const release = async (thing: 'posting' | 'decision') => {
        for (const round of rounds) {
          const opened = await send(as(world.bots.Director!), tournamentId, {
            version: 1,
            commandId: createId(),
            expected: {},
            command: {
              type: 'open-audience',
              eventId: String(round.event_id),
              tabRounds: {
                kind: 'one',
                tabRoundId: String(round.tab_round_id),
              },
              audience: 'public',
              thing,
            },
          });
          if (opened.kind !== 'accepted')
            throw new Error(JSON.stringify(opened));
        }
      };
      await release('posting');
      assert({
        given: 'the source posting is public but its decision still waits',
        should: 'keep the certified result out of public standings',
        actual: [await read(), await counts()],
        expected: [before, [hostBefore, memberBefore, outsiderBefore]],
      });
      await release('decision');
      const after = await read();
      const [hostAfter, memberAfter, outsiderAfter] = await counts();
      assert({
        given:
          'the same published Room and the tournament’s first public decision release',
        should:
          'add certified games to the public record while keeping cards and leaderboard aligned',
        actual: [
          after.every((row) => row.rating === row.card),
          after.some((row) => row.games > 1),
          (
            await world.sql`select count(*)::int as n from rating_changes where round_id=${publicRound}`
          )[0]?.n,
        ],
        expected: [true, true, 4],
      });
      assert({
        given: 'the same approved certification after both source releases',
        should:
          'keep host history stable and add the same games for the league member and outsider',
        actual: [hostAfter, memberAfter?.some((n) => n > 1), outsiderAfter],
        expected: [hostBefore, true, memberAfter],
      });
    },
    { databaseUrl: world.runtimeDatabaseUrl! },
  );
}

async function legacyRatingRecovery(world: World, priorSeasonId: string) {
  const lobbyId = world.made.get('standing-lobby')!;
  const closed = await lobbyAdministrationCommand({
    store: createTabStore(world.database),
    authorize,
    now: world.clock.now,
    newId: createId,
  })(as(world.bots.Director!), {
    version: 1,
    commandId: createId(),
    expected: { season: 1 },
    command: { type: 'close-season', seasonId: priorSeasonId },
  });
  if (closed.kind !== 'accepted') throw new Error(JSON.stringify(closed));
  await openLeagueRatingSeason(world);
  const early = await leagueRoomRating(world, 1, 'public', {
    forfeit: 'Debater 2',
  });
  const late = await leagueRoomRating(world, 1, 'public', {
    forfeit: 'Debater 1',
  });
  const actorId = world.bots['Debater 1']!.actorId;
  await withRoomRuntime(
    async ({ store }) => {
      const publicStanding = async () => {
        const board = await readLadder(store, {
          lobbyId,
          seasonId: null,
          now: new Date(Date.now() + 60_000).toISOString(),
          username: null,
          ladder: { style: 'freestyle', division: 'open' },
        });
        const row = board?.data.entries.find(({ id }) => id === actorId);
        return row && { games: row.played, wins: row.wins, rating: row.rating };
      };
      const changes = () => world.sql<
        { round_id: string; rating_before: number; rating_after: number }[]
      >`select round_id,rating_before,rating_after
      from rating_changes where actor_id=${actorId} and round_id in (${early},${late}) order by occurred_at`;
      const before = await publicStanding();
      assert({
        given: 'two released pre-ledger Rooms before recovery',
        should: 'publish both wins and losses without requiring ledger rows',
        actual: [before?.games, before?.wins, [...(await changes())]],
        expected: [2, 1, []],
      });
      let failFirstWrite = true;
      const failures: string[] = [];
      const sweep = createRatingSweep({
        database: store,
        ids: {
          next: () => {
            if (failFirstWrite) {
              failFirstWrite = false;
              throw new Error('injected first ledger write failure');
            }
            return createId();
          },
        },
        onFailure: (roundId) => failures.push(roundId),
      });
      await sweep({ limit: 100 });
      assert({
        given: 'the first pre-ledger posting fails on a recovery pass',
        should:
          'leave the later game unposted and keep both public games available',
        actual: [failures, [...(await changes())], await publicStanding()],
        expected: [[early], [], before],
      });
      const recovered = await sweep({ limit: 1 });
      assert({
        given:
          'the earlier Room has posted and the second is still unmaterialized',
        should: 'publish the same history once per Room',
        actual: [
          (await changes()).map(({ round_id }) => round_id),
          await publicStanding(),
        ],
        expected: [[early], before],
      });
      await sweep({ limit: 100, afterId: recovered.afterId! });
      const posted = await changes();
      assert({
        given: 'the next recovery pass after that first write failure',
        should:
          'settle both games in completion order and preserve the published rating',
        actual: [
          posted.map(({ round_id }) => round_id),
          posted[0]?.rating_after === posted[1]?.rating_before,
          await publicStanding(),
        ],
        expected: [[early, late], true, before],
      });
    },
    { databaseUrl: world.runtimeDatabaseUrl! },
  );
}
