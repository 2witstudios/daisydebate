import { authorize } from '@daisy/auth/authorization';
import { requireTestServices } from '@daisy/config';
import { createTabStore } from '@daisy/db/tab';
import { withRolledBackDatabase } from '@daisy/db/testing';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { drawCommand } from '../src/features/tab/operations/draw-command';
import { settingCommand } from '../src/features/tab/operations/settings';
import { entryEnrollmentCommand } from '../src/features/tab/operations/entry-enrollment';
import { organizationStage } from './tab-tournament-organization.test-support';
import { leagueAdministrationStage } from './tab-tournament-league-administration.test-support';
import { setupStage } from './tab-tournament-setup.test-support';
import { entryEnrollmentStage } from './tab-tournament-entry-enrollment.test-support';
import { judgeRegistrationStage } from './tab-tournament-judge-registration.test-support';
import { firstDrawCompetition } from './tab-tournament-draw-draft.test-support';
import { as } from './tab-tournament-organization-wiring.test-support';
import { createBots, scriptClock } from './tab-tournament.test-support';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
for (const size of [5, 6, 7])
  test(`a ${size}-person section publishes only when its immutable Room seats fit`, async () => {
    await withRolledBackDatabase(databaseUrl, {
      seed: (sql) =>
        createBots(sql, [
          'Director',
          'Staff',
          'Coach',
          'Judge A',
          'Judge B',
          ...Array.from({ length: size }, (_, i) => `Debater ${i + 1}`),
        ]),
      work: async (database, bots, sql) => {
        const world = {
          database,
          sql,
          bots: Object.fromEntries(bots.map((bot) => [bot.name, bot])),
          clock: scriptClock(),
          made: new Map<string, string>(),
        };
        for (const stage of [
          organizationStage,
          leagueAdministrationStage,
          setupStage,
        ])
          await stage(world);
        const common = {
          store: createTabStore(database),
          authorize,
          now: world.clock.now,
          newId: createId,
        };
        const lobbyId = world.made.get('tournament-lobby')!,
          eventId = world.made.get('event')!;
        const director = as(world.bots.Director!);
        const guard = async () => {
          const value = await common.store.tournamentEventSettings(
            { viewerUserId: world.bots.Director!.userId, lobbyId, eventId },
            async (facts) =>
              facts
                ? {
                    event: facts.configuration.event.version,
                    entries: facts.configuration.event.entriesVersion,
                    settings: facts.configuration.event.settingsVersion,
                  }
                : null,
          );
          if (!value) throw new Error('Missing addressed section event');
          return value;
        };
        const setting = async (command: unknown, expected: unknown) => {
          const answer = await settingCommand(common)(director, {
            version: 1,
            commandId: createId(),
            expected,
            command,
          });
          if (answer.kind !== 'accepted')
            throw new Error(`Section setup refused: ${JSON.stringify(answer)}`);
          return answer.receipt;
        };
        await setting(
          { type: 'stop-following-template', eventId },
          await guard(),
        );
        const template = await setting(
          {
            type: 'create-template',
            organizationId: world.made.get('league')!,
            name: 'Actual speech section',
            format: { id: 'speech-section', version: 1 },
            ballotDefinition: null,
          },
          {},
        );
        await setting(
          {
            type: 'set-setting',
            scope: { kind: 'template', id: template.aggregate.id },
            key: 'pairing.section_size',
            value: { target: 6 },
            hold: 'default',
          },
          { settings: 1 },
        );
        await setting(
          { type: 'copy-template', eventId, templateId: template.aggregate.id },
          await guard(),
        );
        await entryEnrollmentStage(world);
        const entries = entryEnrollmentCommand(common);
        for (let i = 5; i <= size; i++) {
          const name = `Debater ${i}`,
            person = world.bots[name]!;
          const submitted = await entries(as(person), lobbyId, {
            version: 1,
            commandId: createId(),
            expected: { entries: (await guard()).entries },
            command: {
              type: 'submit-entry',
              eventId,
              name,
              memberActorIds: [person.actorId],
              responsible: { kind: 'self' },
              division: null,
            },
          });
          if (submitted.kind !== 'accepted')
            throw new Error('Extra section entry was not submitted');
          const [entry] =
            await sql`select id from entries where event_id=${eventId} and name=${name}`;
          const accepted = await entries(director, lobbyId, {
            version: 1,
            commandId: createId(),
            expected: { entries: submitted.receipt.resultingVersion },
            command: { type: 'accept-entry', entryId: String(entry!.id) },
          });
          if (accepted.kind !== 'accepted')
            throw new Error('Extra section entry was not accepted');
        }
        await judgeRegistrationStage(world);
        const draw = drawCommand({
          ...common,
          competition: firstDrawCompetition,
        });
        const current = await guard();
        const generated = await draw(director, lobbyId, {
          version: 1,
          commandId: createId(),
          expected: { entries: current.entries, settings: current.settings },
          command: {
            type: 'generate-draw',
            tabRoundId: world.made.get('tab-round')!,
            resultCutoff: 0,
            seed: 'ab'.repeat(32),
          },
        });
        if (generated.kind !== 'accepted')
          throw new Error(
            `Section generation refused: ${JSON.stringify(generated)}`,
          );
        const [fixture] =
          await sql`select f.id,f.kind,count(e.entry_id)::int as entries from fixtures f join draw_fixtures d on d.fixture_id=f.id join fixture_entries e on e.fixture_id=f.id where d.draw_id=${generated.receipt.aggregate.id} group by f.id`;
        assert({
          given: `the actual section engine with ${size} entries and target six`,
          should: 'retain its actual section without padding or splitting it',
          actual: [fixture!.kind, fixture!.entries],
          expected: ['section', size],
        });
        const slotVersion = async () =>
          Number(
            (
              await sql`select version from time_slots where id=${world.made.get('time-slot')!}`
            )[0]!.version,
          );
        const assigned = await draw(director, lobbyId, {
          version: 1,
          commandId: createId(),
          expected: { draw: 1, timeSlot: await slotVersion() },
          command: {
            type: 'assign-judges',
            drawId: generated.receipt.aggregate.id,
          },
        });
        if (assigned.kind !== 'accepted')
          throw new Error(`Section panel refused: ${JSON.stringify(assigned)}`);
        const commandId = createId();
        const published = await draw(director, lobbyId, {
          version: 1,
          commandId,
          expected: {
            draw: 1,
            entries: current.entries,
            timeSlot: await slotVersion(),
          },
          command: {
            type: 'publish-draw',
            drawId: generated.receipt.aggregate.id,
            overrides: [],
          },
        });
        const rooms = await sql`select id from rooms where lobby_id=${lobbyId}`;
        const history =
          await sql`select command_id from action_history where command_id=${commandId}`;
        assert({
          given: `an actual ${size}-speaker cast against the immutable six-speaker pin`,
          should:
            size === 6
              ? 'publish the complete ordinary cast'
              : 'refuse before a receipt or partially seated Room',
          actual: [
            published.kind,
            published.kind === 'refused' ? published.refusal : null,
            rooms.length,
            history.length,
          ],
          expected:
            size === 6
              ? ['accepted', null, 1, 1]
              : ['refused', 'draw-unresolved', 0, 0],
        });
        if (size === 6) {
          const seats = await sql<
            {
              seat_kind: string;
              slot: number;
              readiness_command_id: string | null;
            }[]
          >`select seat_kind,slot,readiness_command_id from room_participants where room_id=${String(rooms[0]!.id)} order by seat_kind,slot`;
          assert({
            given: 'the accepted six-person section reloaded from PostgreSQL',
            should:
              'hold exactly six speaker slots and one judge without Ready consent',
            actual: seats.map((row) => [
              row.seat_kind,
              row.slot,
              row.readiness_command_id,
            ]),
            expected: [
              ['judge', 0, null],
              ...Array.from({ length: 6 }, (_, i) => ['speaker', i, null]),
            ],
          });
        }
      },
    });
  });
