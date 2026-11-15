import { authorize } from '@daisy/auth/authorization';
import { requireTestServices } from '@daisy/config';
import { createTabStore } from '@daisy/db/tab';
import { withRolledBackDatabase } from '@daisy/db/testing';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { drawCommand } from '../src/features/tab/operations/draw-command';
import { entryEnrollmentCommand } from '../src/features/tab/operations/entry-enrollment';
import { judgeRegistrationCommand } from '../src/features/tab/operations/judge-registration';
import { setupCommand } from '../src/features/tab/operations/setup';
import { settingCommand } from '../src/features/tab/operations/settings';
import { organizationStage } from './tab-tournament-organization.test-support';
import { leagueAdministrationStage } from './tab-tournament-league-administration.test-support';
import { setupStage } from './tab-tournament-setup.test-support';
import { entryEnrollmentStage } from './tab-tournament-entry-enrollment.test-support';
import { firstDrawCompetition } from './tab-tournament-draw-draft.test-support';
import { as } from './tab-tournament-organization-wiring.test-support';
import { createBots, scriptClock } from './tab-tournament.test-support';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
test('a published bye occupies no Room and cannot consume a judge in another event of the same slot', async () => {
  await withRolledBackDatabase(databaseUrl, {
    seed: (sql) =>
      createBots(sql, [
        'Director',
        'Staff',
        'Coach',
        'Debater 1',
        'Debater 2',
        'Debater 3',
        'Debater 4',
        'Other 1',
        'Other 2',
      ]),
    work: async (database, bots, sql) => {
      const world = {
        database,
        sql,
        bots: Object.fromEntries(bots.map((bot) => [bot.name, bot])),
        clock: scriptClock(),
        made: new Map<string, string>(),
      };
      await organizationStage(world);
      await leagueAdministrationStage(world);
      await setupStage(world);
      await entryEnrollmentStage(world);
      const store = createTabStore(database);
      const common = {
        store,
        authorize,
        now: world.clock.now,
        newId: createId,
      };
      const lobbyId = world.made.get('tournament-lobby')!;
      const eventA = world.made.get('event')!;
      const slotId = world.made.get('time-slot')!;
      const entries = entryEnrollmentCommand(common);
      let aVersion = Number(world.made.get('entries-version'));
      for (const name of ['Debater 2', 'Debater 3', 'Debater 4']) {
        const answer = await entries(as(world.bots.Director!), lobbyId, {
          version: 1,
          commandId: createId(),
          expected: { entries: aVersion },
          command: {
            type: 'withdraw-entry',
            entryId: world.made.get(name)!,
            reason: 'Reducing the field to a genuine bye',
          },
        });
        if (answer.kind !== 'accepted')
          throw new Error(`withdrawal failed: ${JSON.stringify(answer)}`);
        aVersion = answer.receipt.resultingVersion;
      }
      const draw = drawCommand({
        ...common,
        competition: firstDrawCompetition,
      });
      const [a] =
        await sql`select entries_version,settings_version from events where id=${eventA}`;
      const generated = await draw(as(world.bots.Director!), lobbyId, {
        version: 1,
        commandId: createId(),
        expected: {
          entries: Number(a?.entries_version),
          settings: Number(a?.settings_version),
        },
        command: {
          type: 'generate-draw',
          tabRoundId: world.made.get('tab-round')!,
          resultCutoff: 0,
          seed: 'ab'.repeat(32),
        },
      });
      if (generated.kind !== 'accepted')
        throw new Error('one-entry draw did not generate');
      const [bye] =
        await sql`select f.id,f.kind from fixtures f join draw_fixtures d on d.fixture_id=f.id where d.draw_id=${generated.receipt.aggregate.id}`;
      if (bye?.kind !== 'bye')
        throw new Error('the actual engine did not make the expected bye');
      // Existing published fixture data, not a claim that the publication operation is wired.
      // The genuine engine draft is transitioned only as privileged test setup; no result is made.
      await sql.unsafe('reset role');
      await sql`update fixtures set status='published',published_at=${new Date(world.clock.now())} where id=${String(bye.id)}`;
      await sql`update draws set status='published',published_at=${new Date(world.clock.now())} where id=${generated.receipt.aggregate.id}`;
      await sql.unsafe('set local role daisy_web');
      const setup = setupCommand(common);
      const [before] =
        await sql`select version from lobbies where id=${lobbyId}`;
      let lobbyVersion = Number(before?.version);
      const add = async (command: unknown) => {
        const answer = await setup(as(world.bots.Director!), {
          version: 1,
          commandId: createId(),
          expected: { lobby: lobbyVersion },
          command,
        });
        if (answer.kind !== 'accepted')
          throw new Error(`setup refused: ${JSON.stringify(answer)}`);
        lobbyVersion = answer.receipt.resultingVersion;
      };
      await add({
        type: 'add-event',
        lobbyId,
        name: 'Other event',
        label: 'OTHER',
        entry: { kind: 'person' },
        pin: {
          kind: 'format',
          formatId: 'freestyle',
          formatVersion: 1,
          ballotDefinition: null,
        },
      });
      const [event] =
        await sql`select id from events where lobby_id=${lobbyId} and name='Other event'`;
      const eventB = String(event?.id);
      await add({
        type: 'add-stage',
        lobbyId,
        eventId: eventB,
        kind: 'preliminary',
        place: 'online',
        timing: { timing: 'live' },
        division: null,
      });
      const [stage] = await sql`select id from stages where event_id=${eventB}`;
      const [resolution] =
        await sql`select pool_id,id from pool_resolutions where lobby_id=${lobbyId} limit 1`;
      await add({
        type: 'add-tab-round',
        lobbyId,
        stageId: String(stage?.id),
        name: 'Other Round 1',
        resolution: {
          poolId: String(resolution?.pool_id),
          poolResolutionId: String(resolution?.id),
        },
      });
      const [round] =
        await sql`select id from tab_rounds where event_id=${eventB}`;
      const roundB = String(round?.id);
      await add({
        type: 'place-tab-round',
        lobbyId,
        tabRoundId: roundB,
        timeSlotId: slotId,
      });
      const configured = await settingCommand(common)(
        as(world.bots.Director!),
        {
          version: 1,
          commandId: createId(),
          expected: { settings: 1 },
          command: {
            type: 'set-setting',
            scope: { kind: 'event', id: eventB },
            key: 'entry.registration',
            value: { state: 'open' },
            hold: 'default',
          },
        },
      );
      if (configured.kind !== 'accepted')
        throw new Error('registration setup refused');
      let bVersion = 1;
      for (const name of ['Other 1', 'Other 2']) {
        const person = world.bots[name]!;
        const submitted = await entries(as(person), lobbyId, {
          version: 1,
          commandId: createId(),
          expected: { entries: bVersion },
          command: {
            type: 'submit-entry',
            eventId: eventB,
            name,
            memberActorIds: [person.actorId],
            responsible: { kind: 'self' },
            division: null,
          },
        });
        if (submitted.kind !== 'accepted')
          throw new Error('other entrant refused');
        bVersion = submitted.receipt.resultingVersion;
        const [entry] =
          await sql`select id from entries where event_id=${eventB} and name=${name}`;
        const accepted = await entries(as(world.bots.Director!), lobbyId, {
          version: 1,
          commandId: createId(),
          expected: { entries: bVersion },
          command: { type: 'accept-entry', entryId: String(entry?.id) },
        });
        if (accepted.kind !== 'accepted')
          throw new Error('other approval refused');
        bVersion = accepted.receipt.resultingVersion;
      }
      const judge = judgeRegistrationCommand({
        ...common,
        minorsReleased: async () => false,
      });
      const person = world.bots['Debater 1']!;
      const invited = await judge(as(world.bots.Director!), lobbyId, {
        version: 1,
        commandId: createId(),
        expected: {},
        command: {
          type: 'invite-judge',
          actorId: person.actorId,
          schoolOrganizationId: null,
          chairQualified: true,
          eventIds: [eventB],
        },
      });
      if (invited.kind !== 'accepted')
        throw new Error('bye entrant judge invitation refused');
      const [registration] =
        await sql`select id from tournament_judges where lobby_id=${lobbyId} and actor_id=${person.actorId}`;
      const judgeId = String(registration?.id);
      for (const command of [
        { type: 'accept-judge-invitation', tournamentJudgeId: judgeId },
        {
          type: 'set-judge-availability',
          tournamentJudgeId: judgeId,
          availability: [{ timeSlotId: slotId, available: true }],
        },
      ]) {
        const answer = await judge(as(person), lobbyId, {
          version: 1,
          commandId: createId(),
          expected: {},
          command,
        });
        if (answer.kind !== 'accepted')
          throw new Error('bye entrant judge acceptance refused');
      }
      const [current] =
        await sql`select entries_version,settings_version from events where id=${eventB}`;
      const otherDraw = await draw(as(world.bots.Director!), lobbyId, {
        version: 1,
        commandId: createId(),
        expected: {
          entries: Number(current?.entries_version),
          settings: Number(current?.settings_version),
        },
        command: {
          type: 'generate-draw',
          tabRoundId: roundB,
          resultCutoff: 0,
          seed: 'cd'.repeat(32),
        },
      });
      if (otherDraw.kind !== 'accepted')
        throw new Error(`other draw refused: ${JSON.stringify(otherDraw)}`);
      const [slot] =
        await sql`select version from time_slots where id=${slotId}`;
      const assigned = await draw(as(world.bots.Director!), lobbyId, {
        version: 1,
        commandId: createId(),
        expected: { draw: 1, timeSlot: Number(slot?.version) },
        command: {
          type: 'assign-judges',
          drawId: otherDraw.receipt.aggregate.id,
        },
      });
      assert({
        given:
          'a genuine published bye and its entrant available to judge a different event in that actual slot',
        should: 'seat that judge because the bye holds no Room',
        actual: [
          assigned.kind === 'accepted' ? 'accepted' : assigned,
          (
            await sql`select tournament_judge_id from fixture_judges where event_id=${eventB}`
          ).map(
            (row: { tournament_judge_id: string }) => row.tournament_judge_id,
          ),
          (
            await sql`select room_id from fixtures where id=${String(bye.id)}`
          )[0]?.room_id,
        ],
        expected: ['accepted', [judgeId], null],
      });
    },
  });
});
