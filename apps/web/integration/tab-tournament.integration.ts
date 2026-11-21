import { createId } from '@paralleldrive/cuid2';
import { isAppError } from '@daisy/errors';
import { deniedAsNotFound } from './tab-tournament-organization-wiring.test-support';
import { ratingStage } from './tab-tournament-rating.test-support';
import { notificationsStage } from './tab-tournament-notifications.test-support';
import { seasonStage } from './tab-tournament-season.test-support';
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
import { withRoomRuntime } from './room-runtime.test-support';
import {
  scratchDatabase,
  committingRuntimeTestDatabase,
} from '@daisy/db/testing';
import { SQL } from 'bun';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
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
    run: (world) => resultsStage(world, true),
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
    run: seasonStage,
  },
  {
    name: 'rating-seeded single elimination',
    run: ratingStage,
  },
  { name: 'notifications', run: notificationsStage },
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
  process.stdout.write(`${reportLines(reports)}\n`);
  assert({
    given: 'the complete league-and-notifications tournament journey',
    should: 'execute every stage with no pending record',
    actual: [
      reports.filter((report) => report.outcome === 'passed').length,
      reports.filter((report) => report.outcome === 'pending').length,
    ],
    expected: [12, 0],
  });
  assert({
    given: 'a tournament scripted from an empty database',
    should:
      'pass all twelve real stages through league standings, rating seeding and notifications',
    actual: reportLines(reports).replace(/ \(\d+ ms\)/g, ''),
    expected: stages
      .map((stage) =>
        'pending' in stage
          ? `  - ${stage.name}: pending (${stage.pending})`
          : `  ✓ ${stage.name}`,
      )
      .join('\n'),
  });
}, 90_000);

test('a league tournament inherits Youth from entry through seated play', async () => {
  const scratch = scratchDatabase(databaseUrl, 'youthtournament');
  await scratch.create();
  const owner = new SQL(scratch.url, { max: 4 });
  try {
    await scratch.migrate(() => true);
    const bots = await createBots(owner, names);
    const world: World = {
      database: committingRuntimeTestDatabase(owner),
      sql: owner,
      runtimeDatabaseUrl: scratch.url,
      clock: scriptClock(Date.now() - 60 * 60_000),
      bots: Object.fromEntries(bots.map((bot) => [bot.name, bot])),
      made: new Map(),
    };
    await organizationStage(world);
    await leagueAdministrationStage(world, { tournamentOwner: 'organization' });
    await setupStage(world);
    const parent = world.made.get('standing-lobby')!;
    const tournament = world.made.get('tournament-lobby')!;
    await owner`update lobbies set age_rule='under-18' where id=${parent}`;
    await entryEnrollmentStage(world, 'under-18');
    const carried = world.bots['Debater 1']!;
    const season = createId();
    await owner`update account_age set birth_month=to_char(now()-interval '18 years','YYYY-MM'),
      recorded_at=now()-interval '2 months' where user_id=${carried.userId}`;
    await owner`insert into seasons (id, lobby_id, organization_id, name, starts_at, status)
      values (${season}, ${parent}, ${world.made.get('league')!}, 'Current Youth season', now()-interval '1 month', 'active')`;
    const setSeason = (active: boolean) =>
      owner`update seasons set status=${active ? 'active' : 'closed'},
        ends_at=case when ${active} then null else now() end where id=${season}`;
    await judgeRegistrationStage(world);
    await draftDrawStage(world);
    await publishDrawStage(world, async (attempt) => {
      await setSeason(false);
      const denied = await deniedAsNotFound(attempt);
      const [unchanged] = await owner`
        select (select count(*)::int from rooms where lobby_id=${tournament}) rooms,
          (select count(*)::int from entries where lobby_id=${tournament} and status='accepted') entries
      `;
      assert({
        given: 'an accepted Youth entry that ages out after its season closes',
        should:
          'refuse publication without seating anyone or changing the accepted roster',
        actual: [denied, unchanged],
        expected: [true, { rooms: 0, entries: 4 }],
      });
      await setSeason(true);
    });

    const room = world.made.get('first-room')!;
    const director = world.bots.Director!;
    await withRoomRuntime(
      async (runtime) => {
        const view = await runtime.operations.view(director, room);
        assert({
          given:
            'the published Room in a league tournament whose standing parent is Youth',
          should: 'seat two accepted debaters and project the inherited rule',
          actual: {
            ageRule: view.ageRule,
            debaters: view.participants.filter(
              ({ seat }) => seat.kind === 'side',
            ).length,
          },
          expected: { ageRule: 'under-18', debaters: 2 },
        });
      },
      { databaseUrl: scratch.url },
    );
    const [carriedRoom] = await owner<{ room_id: string }[]>`
      select p.room_id from room_participants p join rooms r on r.id=p.room_id
      where p.actor_id=${carried.actorId} and r.lobby_id=${tournament}
    `;
    await withRoomRuntime(
      async (runtime) => {
        const id = carriedRoom!.room_id;
        const cast = await owner<{ actor_id: string; user_id: string }[]>`
        select p.actor_id,a.user_id from room_participants p
        join actors a on a.id=p.actor_id where p.room_id=${id}
      `;
        const otherDivision = (action: () => Promise<unknown>) =>
          action().then(
            () => false,
            (error: unknown) =>
              isAppError(error) && error.reason === 'other-division',
          );
        await setSeason(false);
        const blockedReady = await otherDivision(async () =>
          runtime.consent(
            carried,
            await runtime.operations.view(carried, id),
            'ready',
          ),
        );
        await setSeason(true);
        for (const { actor_id, user_id } of cast) {
          const person = { userId: user_id, actorId: actor_id };
          await runtime.consent(
            person,
            await runtime.operations.view(person, id),
            'ready',
          );
        }
        await setSeason(false);
        const ready = await runtime.operations.view(director, id);
        const blockedStart = await otherDivision(() =>
          runtime.operations.command(director, id, {
            type: 'start-round',
            commandId: createId(),
            expectedVersion: ready.version,
          }),
        );
        const [started] =
          await owner`select count(*)::int as n from rounds where room_id=${id}`;
        assert({
          given: 'the carried debater seated before the active season ends',
          should:
            'refuse Ready after rollover and recheck the full cast at Start after Ready',
          actual: [blockedReady, blockedStart, started!.n],
          expected: [true, true, 0],
        });
        await setSeason(true);
        for (const { actor_id, user_id } of cast) {
          const person = { userId: user_id, actorId: actor_id };
          await runtime.consent(
            person,
            await runtime.operations.view(person, id),
            'unready',
          );
        }
      },
      { databaseUrl: scratch.url },
    );
    await resultsStage(world, true);
    await owner`update lobbies set age_rule='adults' where id=${parent}`;
    await owner`delete from account_age where user_id=${carried.userId}`;
    const [played] = await owner`
      select count(*)::int as rounds,
        bool_and(public.daisy_room_is_youth(r.room_id)) as youth,
        bool_or(public.daisy_round_reuse_age_unknown(r.id)) as unknown,
        bool_and(r.standing_age_rule='under-18') as "frozenRule"
      from rounds r join rooms room on room.id=r.room_id
      where room.lobby_id=${tournament}
    `;
    assert({
      given:
        'the accepted Youth entries after the real Ready, Start and debate commands',
      should:
        'retain both played Youth Rounds and their reuse class after an Adults rule edit',
      actual: played,
      expected: { rounds: 2, youth: true, unknown: false, frozenRule: true },
    });
  } finally {
    await owner.close();
    await scratch.drop();
  }
}, 90_000);
