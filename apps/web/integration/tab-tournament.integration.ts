import { setupStage } from './tab-tournament-setup.test-support';
import { leagueAdministrationStage } from './tab-tournament-league-administration.test-support';
import { requireTestServices } from '@daisy/config';
import { withRolledBackDatabase } from '@daisy/db/testing';
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
    run: unwired('league'),
  },
  {
    name: 'tournament setup: settings, events, stages, time slots',
    run: setupStage,
  },
  { name: 'entries and judges by invitation', run: unwired('entries') },
  {
    name: 'draw published: event Rooms seated, with provenance',
    run: unwired('draw'),
  },
  {
    name: 'officiating: grants, conflicts, judge no-show',
    run: unwired('officiating'),
  },
  {
    name: 'ballots to results: late ballot, correction',
    run: unwired('results'),
  },
  {
    name: 'standings, break, bracket and certification',
    run: unwired('standings'),
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
  // The tab record is append-only by trigger, so the run is one transaction
  // that is rolled back: the suite leaves no rows behind. The bots are made
  // as the migration owner; every stage runs as the web runtime role, so
  // the tenant fences bind.
  const reports = await withRolledBackDatabase(databaseUrl, {
    seed: (sql) => createBots(sql, names),
    work: (database, bots, sql) =>
      runStages(stages, {
        database,
        sql,
        clock: scriptClock(),
        bots: Object.fromEntries(bots.map((bot) => [bot.name, bot])),
        made: new Map(),
      }),
  });
  assert({
    given: 'a tournament scripted from an empty database',
    should: 'run every stage to certified results',
    actual: reportLines(reports).replace(/ \(\d+ ms\)/g, ''),
    expected: stages.map((stage) => `  ✓ ${stage.name}`).join('\n'),
  });
});
