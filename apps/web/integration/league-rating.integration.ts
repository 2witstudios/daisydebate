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
import { ratingPolicy } from '@daisy/debate-engine';
import { lobbyAdministrationCommand } from '../src/features/tab/operations/lobby-administration';
import { as } from './tab-tournament-organization-wiring.test-support';
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
    ])
      await run(world);
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
  } finally {
    await owner.close();
    await scratch.drop();
  }
}, 180_000);
