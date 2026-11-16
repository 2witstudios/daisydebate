import { completionStage } from './tab-tournament-completion.test-support';
import { resultsStage } from './tab-tournament-results.test-support';
import { standingsStage } from './tab-tournament-standings.test-support';
import { officiatingStage } from './tab-tournament-officiating.test-support';
import { publishDrawStage } from './tab-tournament-publication.test-support';
import { draftDrawStage } from './tab-tournament-draw-draft.test-support';
import { leagueConfigurationStage } from './tab-tournament-league-configuration.test-support';
import { entryEnrollmentStage } from './tab-tournament-entry-enrollment.test-support';
import { judgeRegistrationStage } from './tab-tournament-judge-registration.test-support';
import { setupStage } from './tab-tournament-setup.test-support';
import { leagueAdministrationStage } from './tab-tournament-league-administration.test-support';
import { requireTestServices } from '@daisy/config';
import {
  scratchDatabase,
  committingRuntimeTestDatabase,
} from '@daisy/db/testing';
import { SQL } from 'bun';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  StageNotWired,
  createBots,
  reportLines,
  runStages,
  scriptClock,
  type Stage,
  type World,
} from './tab-tournament.test-support';
import { organizationStage } from './tab-tournament-organization.test-support';

/**
 * The scripted tournament (TAB-8.18), the parent branch's gate: bots take a
 * tournament from an empty database to certified results through the wired
 * commands and reads, with an injected clock and no browser, media or real
 * time. Each wiring step takes it one stage further; a stage not yet wired
 * fails the script by name.
 */

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

const unwired =
  (stage: string) =>
  async (_world: World): Promise<void> => {
    throw new StageNotWired(stage);
  };

/** The tournament, in the plan's dependency order. */
const stages: readonly Stage<World>[] = [
  {
    name: 'organizations, memberships and preset-role grants',
    run: organizationStage,
  },
  {
    name: 'league lobby, season and ladder administration',
    run: leagueAdministrationStage,
  },
  {
    name: 'league templates, resolution pool and resolved create-room form',
    run: leagueConfigurationStage,
  },
  {
    name: 'tournament setup: settings, events, stages, time slots',
    run: setupStage,
  },
  {
    name: 'entries and judges by invitation',
    run: async (world) => {
      await entryEnrollmentStage(world);
      await judgeRegistrationStage(world);
    },
  },
  {
    name: 'draw published: event Rooms seated, with provenance',
    run: async (world) => {
      await draftDrawStage(world);
      await publishDrawStage(world);
    },
  },
  {
    name: 'officiating: grants, conflicts, judge no-show',
    run: officiatingStage,
  },
  {
    name: 'ballots to results: late ballot, correction',
    run: resultsStage,
  },
  {
    name: 'standings, break, bracket and certification',
    run: async (world) => {
      await standingsStage(world);
      await completionStage(world);
    },
  },
  {
    name: 'sanction and season standings',
    run: unwired('sanction'),
  },
  {
    name: 'rating-seeded single elimination',
    run: unwired('single-elimination'),
  },
  { name: 'notifications', run: unwired('notifications') },
];

const names = [
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
];

test('the scripted tournament', async () => {
  // The entire private database is dropped. Each command commits under the
  // actual runtime role, so ordinary Room/Round requests see real publication
  // and later stages cannot depend on an uncommitted owner transaction.
  const scratch = scratchDatabase(databaseUrl, 'fulltournament');
  await scratch.create();
  const owner = new SQL(scratch.url, { max: 4 });
  let reports;
  try {
    await scratch.migrate(() => true);
    const bots = await createBots(owner, names);
    reports = await runStages(stages, {
      database: committingRuntimeTestDatabase(owner),
      sql: owner,
      runtimeDatabaseUrl: scratch.url,
      clock: scriptClock(Date.now() - 60 * 60_000),
      bots: Object.fromEntries(bots.map((bot) => [bot.name, bot])),
      made: new Map(),
    });
  } finally {
    await owner.close();
    await scratch.drop();
  }
  assert({
    given: 'a tournament scripted from an empty database',
    should: 'run every stage to certified results',
    actual: reportLines(reports).replace(/ \(\d+ ms\)/g, ''),
    expected: stages.map((stage) => `  ✓ ${stage.name}`).join('\n'),
  });
}, 90_000);
