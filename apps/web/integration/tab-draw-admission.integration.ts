import { authorize } from '@daisy/auth/authorization';
import { requireTestServices } from '@daisy/config';
import { createTabStore } from '@daisy/db/tab';
import { withRolledBackDatabase } from '@daisy/db/testing';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { drawCommand } from '../src/features/tab/operations/draw-command';
import { setupCommand } from '../src/features/tab/operations/setup';
import { entryEnrollmentCommand } from '../src/features/tab/operations/entry-enrollment';
import { judgeRegistrationCommand } from '../src/features/tab/operations/judge-registration';
import { settingCommand } from '../src/features/tab/operations/settings';
import { preparePublication } from './tab-publication-setup.test-support';
import { publishDrawStage } from './tab-tournament-publication.test-support';
import { firstDrawCompetition } from './tab-tournament-draw-draft.test-support';
import {
  as,
  deniedAsNotFound,
} from './tab-tournament-organization-wiring.test-support';
import { createBots, scriptClock } from './tab-tournament.test-support';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
test('draw admission follows new seats while unrelated accounts and cleanup do not block the addressed event', async () => {
  await withRolledBackDatabase(databaseUrl, {
    seed: (sql) =>
      createBots(sql, [
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
        'Other entrant',
        'Other judge',
      ]),
    work: async (database, bots, sql) => {
      const world = {
        database,
        sql,
        bots: Object.fromEntries(bots.map((bot) => [bot.name, bot])),
        clock: scriptClock(),
        made: new Map<string, string>(),
      };
      await preparePublication(world, 'copy');
      const common = {
        store: createTabStore(database),
        authorize,
        now: world.clock.now,
        newId: createId,
      };
      const lobbyId = world.made.get('tournament-lobby')!,
        eventId = world.made.get('event')!;
      const director = as(world.bots.Director!);
      const [lobby] =
        await sql`select version from lobbies where id=${lobbyId}`;
      const added = await setupCommand(common)(director, {
        version: 1,
        commandId: createId(),
        expected: { lobby: Number(lobby!.version) },
        command: {
          type: 'add-event',
          lobbyId,
          name: 'Unrelated',
          label: 'OTHER',
          entry: { kind: 'person' },
          pin: {
            kind: 'format',
            formatId: 'freestyle',
            formatVersion: 1,
            ballotDefinition: null,
          },
        },
      });
      if (added.kind !== 'accepted')
        throw new Error('Other event was not created');
      const [other] =
        await sql`select id from events where lobby_id=${lobbyId} and name='Unrelated'`;
      const otherEventId = String(other!.id);
      const setting = await settingCommand(common)(director, {
        version: 1,
        commandId: createId(),
        expected: { settings: 1 },
        command: {
          type: 'set-setting',
          scope: { kind: 'event', id: otherEventId },
          key: 'entry.registration',
          value: { state: 'open' },
          hold: 'default',
        },
      });
      if (setting.kind !== 'accepted')
        throw new Error('Other registration was not opened');
      const entries = entryEnrollmentCommand(common),
        entrant = world.bots['Other entrant']!;
      const submitted = await entries(as(entrant), lobbyId, {
        version: 1,
        commandId: createId(),
        expected: { entries: 1 },
        command: {
          type: 'submit-entry',
          eventId: otherEventId,
          name: 'Unrelated entrant',
          memberActorIds: [entrant.actorId],
          responsible: { kind: 'self' },
          division: null,
        },
      });
      if (submitted.kind !== 'accepted')
        throw new Error('Other entry was not submitted');
      const [entry] =
        await sql`select id,status from entries where event_id=${otherEventId}`;
      if (entry!.status !== 'accepted') {
        const accepted = await entries(director, lobbyId, {
          version: 1,
          commandId: createId(),
          expected: { entries: submitted.receipt.resultingVersion },
          command: { type: 'accept-entry', entryId: String(entry!.id) },
        });
        if (accepted.kind !== 'accepted')
          throw new Error('Other entry was not accepted');
      }
      const judges = judgeRegistrationCommand({
          ...common,
          minorsReleased: async () => false,
        }),
        judge = world.bots['Other judge']!;
      const invited = await judges(director, lobbyId, {
        version: 1,
        commandId: createId(),
        expected: {},
        command: {
          type: 'invite-judge',
          actorId: judge.actorId,
          schoolOrganizationId: null,
          chairQualified: true,
          eventIds: [otherEventId],
        },
      });
      if (invited.kind !== 'accepted')
        throw new Error('Other judge was not invited');
      const [registration] =
        await sql`select id from tournament_judges where lobby_id=${lobbyId} and actor_id=${judge.actorId}`;
      const acceptedJudge = await judges(as(judge), lobbyId, {
        version: 1,
        commandId: createId(),
        expected: {},
        command: {
          type: 'accept-judge-invitation',
          tournamentJudgeId: String(registration!.id),
        },
      });
      if (acceptedJudge.kind !== 'accepted')
        throw new Error('Other judge was not accepted');
      // Privileged fixture changes represent an actual loss of current account membership.
      await sql.unsafe('reset role');
      await sql`update users set email_verified=false,version=version+1 where id in (${entrant.userId},${judge.userId})`;
      await sql.unsafe('set local role daisy_web');
      const draw = drawCommand({
        ...common,
        competition: firstDrawCompetition,
      });
      const discarded = await draw(director, lobbyId, {
        version: 1,
        commandId: createId(),
        expected: { draw: 1 },
        command: { type: 'discard-draft', drawId: world.made.get('draw')! },
      });
      assert({
        given: 'unrelated accepted entrant and judge accounts lose membership',
        should: 'allow the host to discard the addressed event draft',
        actual: discarded.kind,
        expected: 'accepted',
      });
      const [event] =
        await sql`select entries_version,settings_version from events where id=${eventId}`;
      const generated = await draw(director, lobbyId, {
        version: 1,
        commandId: createId(),
        expected: {
          results: 1,
          entries: Number(event!.entries_version),
          settings: Number(event!.settings_version),
        },
        command: {
          type: 'generate-draw',
          tabRoundId: world.made.get('tab-round')!,
          resultCutoff: 0,
          seed: 'ab'.repeat(32),
        },
      });
      if (generated.kind !== 'accepted')
        throw new Error('Addressed event did not generate');
      const drawId = generated.receipt.aggregate.id;
      world.made.set('draw', drawId);
      const [slot] =
        await sql`select version from time_slots where id=${world.made.get('time-slot')!}`;
      const assigned = await draw(director, lobbyId, {
        version: 1,
        commandId: createId(),
        expected: { draw: 1, timeSlot: Number(slot!.version) },
        command: { type: 'assign-judges', drawId },
      });
      assert({
        given: 'the unrelated accounts remain unadmitted',
        should: 'generate and seat only the actual event candidates',
        actual: [generated.kind, assigned.kind],
        expected: ['accepted', 'accepted'],
      });
      const [afterSlot] =
        await sql`select version from time_slots where id=${world.made.get('time-slot')!}`;
      const publish = {
        version: 1,
        commandId: createId(),
        expected: {
          draw: 1,
          entries: Number(event!.entries_version),
          timeSlot: Number(afterSlot!.version),
        },
        command: { type: 'publish-draw', drawId, overrides: [] },
      };
      const actual = world.bots['Debater 1']!;
      await sql.unsafe('reset role');
      await sql`update users set email_verified=false,version=version+1 where id=${actual.userId}`;
      await sql.unsafe('set local role daisy_web');
      const denied = await deniedAsNotFound(() =>
        draw(director, lobbyId, publish),
      );
      assert({
        given: 'an actual cast account loses membership after the draft',
        should: 'deny new Room admission without a receipt or Room',
        actual: [
          denied,
          (await sql`select id from rooms where lobby_id=${lobbyId}`).length,
          (
            await sql`select command_id from action_history where command_id=${publish.commandId}`
          ).length,
        ],
        expected: [true, 0, 0],
      });
      // Cleanup must remain possible even for the draft's own no-longer-admitted cast.
      const cleanup = await draw(director, lobbyId, {
        version: 1,
        commandId: createId(),
        expected: { draw: 1 },
        command: { type: 'discard-draft', drawId },
      });
      assert({
        given: 'the draft contains a no-longer-admitted actual entrant',
        should: 'still allow non-admission cleanup',
        actual: cleanup.kind,
        expected: 'accepted',
      });
      await sql.unsafe('reset role');
      await sql`update users set email_verified=true,version=version+1 where id=${actual.userId}`;
      await sql.unsafe('set local role daisy_web');
      const regenerated = await draw(director, lobbyId, {
        version: 1,
        commandId: createId(),
        expected: {
          results: 1,
          entries: Number(event!.entries_version),
          settings: Number(event!.settings_version),
        },
        command: {
          type: 'generate-draw',
          tabRoundId: world.made.get('tab-round')!,
          resultCutoff: 0,
          seed: 'ab'.repeat(32),
        },
      });
      if (regenerated.kind !== 'accepted')
        throw new Error('Restored event did not generate');
      world.made.set('draw', regenerated.receipt.aggregate.id);
      const reassigned = await draw(director, lobbyId, {
        version: 1,
        commandId: createId(),
        expected: { draw: 1, timeSlot: Number(afterSlot!.version) },
        command: {
          type: 'assign-judges',
          drawId: regenerated.receipt.aggregate.id,
        },
      });
      if (reassigned.kind !== 'accepted')
        throw new Error('Restored judges did not assign');
      const judgeA = world.bots['Judge A']!;
      await sql.unsafe('reset role');
      await sql`update account_beta_access set state='pending',decided_at=null,revision=revision+1 where user_id=${judgeA.userId}`;
      await sql.unsafe('set local role daisy_web');
      const [currentSlot] =
        await sql`select version from time_slots where id=${world.made.get('time-slot')!}`;
      const unavailable = await draw(director, lobbyId, {
        ...publish,
        commandId: createId(),
        expected: {
          ...publish.expected,
          timeSlot: Number(currentSlot!.version),
        },
        command: {
          ...publish.command,
          drawId: regenerated.receipt.aggregate.id,
        },
      });
      assert({
        given:
          'an assigned judge loses canonical participant access but keeps identity membership',
        should: 'refuse its panel before any Room is published',
        actual: [
          unavailable,
          (await sql`select id from rooms where lobby_id=${lobbyId}`).length,
        ],
        expected: [{ kind: 'refused', refusal: 'judges-insufficient' }, 0],
      });
      await sql.unsafe('reset role');
      await sql`update account_beta_access set state='approved',decided_at=now(),revision=revision+1 where user_id=${judgeA.userId}`;
      await sql.unsafe('set local role daisy_web');
      await publishDrawStage(world);
    },
  });
}, 30_000);
