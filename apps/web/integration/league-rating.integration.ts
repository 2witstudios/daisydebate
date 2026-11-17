import { leagueRatingCorrection } from './league-rating-correction.test-support';
import { leagueRoomRating } from './league-room-rating.test-support';
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
    // Sanction commands belong to the season proof. This is the exact durable
    // published input the rating consumer receives from that separate owner.
    const [season] =
      await owner`select id from seasons where organization_id=${world.made.get('league')!}`;
    await owner`insert into sanctions (id,organization_id,lobby_id,event_id,season_id,template_id,status,decided_at) values (${createId()},${world.made.get('league')!},${world.made.get('tournament-lobby')!},${world.made.get('event')!},${season!.id},${world.made.get('league-template')!},'approved',${world.clock.now()})`;
    await leagueRoomRating(world);
    await ratingStage(world);
    await leagueRatingCorrection(world);
  } finally {
    await owner.close();
    await scratch.drop();
  }
}, 180_000);
