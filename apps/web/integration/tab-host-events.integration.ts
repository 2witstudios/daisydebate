import {
  createHostEventsRoute,
  hostEventsPath,
} from '../src/features/tab/host-events-route';
import { createLobbyCommandRoute } from '../src/features/tab/lobby-command-route';
import { hostEventsViewSchema } from '@daisy/protocol/lobby/host-events-read';
import { lobbyCommandReceiptSchema } from '@daisy/protocol/lobby/command';
import { z } from 'zod';
import { noopErrorReporter } from '@daisy/observability';
import {
  member,
  origin,
} from '../src/features/auth/member-boundary.test-support';
import { silentLogger } from '../src/server/test-loggers.test-support';
import { eventAside, eventScheduleBoard } from '../src/features/tab/events';
import { proveEventScheduleForms } from './tab-events-schedule.test-support';
import { authorize } from '@daisy/auth/authorization';
import { requireTestServices } from '@daisy/config';
import { createTabStore } from '@daisy/db/tab';
import { withRolledBackDatabase } from '@daisy/db/testing';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { readHostEvents } from '../src/features/tab/reads/host-events';
import { eventFormEnvelope } from '../src/features/tab/event-form';
import { organizationStage } from './tab-tournament-organization.test-support';
import { leagueAdministrationStage } from './tab-tournament-league-administration.test-support';
import { createBots, scriptClock } from './tab-tournament.test-support';
import { as } from './tab-tournament-organization-wiring.test-support';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
test('Events authoring retains empty setup and persisted identity through create, cancel and edit', async () => {
  await withRolledBackDatabase(databaseUrl, {
    seed: (sql) => createBots(sql, ['Director', 'Staff', 'Coach', 'Judge A']),
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
      const lobbyId = world.made.get('tournament-lobby')!,
        store = createTabStore(database),
        dependencies = {
          store,
          authorize,
          now: world.clock.now,
          newId: createId,
        };
      const read = readHostEvents(dependencies),
        principal = as(world.bots.Director!);
      const boundary = {
        logger: silentLogger,
        reporter: noopErrorReporter,
        origin: () => origin,
        identify: async () => ({
          ...member,
          principal: { ...principal, actorId: world.bots.Director!.actorId },
        }),
      };
      const route = createLobbyCommandRoute({
        ...dependencies,
        boundary,
        released: async () => true,
      });
      const send = async (_principal: typeof principal, envelope: unknown) => {
        const response = await route(
          new Request(`${origin}/api/tab/lobby-command`, {
            method: 'POST',
            headers: { origin, 'content-type': 'application/json' },
            body: JSON.stringify(envelope),
          }),
        );
        if (response.status !== 200)
          throw new Error(`Events POST status ${response.status}`);
        return z
          .discriminatedUnion('kind', [
            z.object({
              kind: z.literal('accepted'),
              receipt: lobbyCommandReceiptSchema,
            }),
            z.object({ kind: z.literal('refused'), refusal: z.string() }),
          ])
          .parse(await response.json());
      };
      const get = (released: boolean) =>
        createHostEventsRoute({
          boundary,
          released: async () => released,
          read,
        });
      const request = () => new Request(`${origin}${hostEventsPath(lobbyId)}`);
      const response = await get(true)(request());
      const before = hostEventsViewSchema.parse(await response.json());
      assert({
        given: 'the actual Events HTTP boundary and current owner',
        should: 'return no-store authoring metadata only behind the release',
        actual: [
          response.status,
          response.headers.get('cache-control'),
          (await get(false)(request())).status,
        ],
        expected: [200, 'no-store', 404],
      });
      if (!before) throw new Error('Missing actual Events read');
      assert({
        given: 'the genuine new tournament before any event exists',
        should:
          'show zero events with actual format choices and conceal a non-host',
        actual: [
          before.setup.events.length,
          before.pinOptions.some(
            (pin) =>
              pin.pin.kind === 'format' && pin.pin.formatId === 'freestyle',
          ),
          await read(as(world.bots.Coach!), lobbyId),
        ],
        expected: [0, true, null],
      });
      const original = (
        await sql`select count(*)::int n from action_history where lobby_id=${lobbyId}`
      )[0]!.n;
      const opening = eventAside(before.setup, { create: true, eventId: null });
      const cancelled = eventAside(
        hostEventsViewSchema.parse(await (await get(true)(request())).json())
          .setup,
        { create: false, eventId: null },
      );
      assert({
        given: 'opening and cancelling the explicit create aside',
        should: 'retain none/create state and no fabricated selected event',
        actual: [
          opening?.kind,
          cancelled?.kind,
          eventScheduleBoard(before, {
            create: false,
            eventId: null,
            nextId: createId,
          })?.aside,
        ],
        expected: ['create', 'none', null],
      });
      assert({
        given: 'opening and cancelling create with only the actual read',
        should: 'write no event or command history',
        actual: [
          (
            await sql`select count(*)::int n from events where lobby_id=${lobbyId}`
          )[0]!.n,
          (
            await sql`select count(*)::int n from action_history where lobby_id=${lobbyId}`
          )[0]!.n,
        ],
        expected: [0, original],
      });
      const pin = before.pinOptions.find(
        (option) =>
          option.pin.kind === 'format' && option.pin.formatId === 'freestyle',
      );
      if (!pin) throw new Error('No published freestyle choice');
      const form = new FormData();
      form.set('name', 'Created event');
      form.set('label', 'CRE');
      form.set('pin', pin.key);
      form.set('entryKind', 'person');
      form.set('teamSize', '2');
      form.set('lobbyId', createId());
      const context = {
        handle: 'tournament',
        returnEventId: null,
        lobbyId,
        commandId: createId(),
        lobbyVersion: before.lobbyVersion,
        target: { kind: 'create' as const, pinOptions: before.pinOptions },
      };
      const envelope = eventFormEnvelope(context, form),
        created = await send(principal, envelope);
      if (created.kind !== 'accepted')
        throw new Error('Actual create was refused');
      const after = await read(principal, lobbyId);
      const event = after?.setup.events[0];
      if (!event || !after) throw new Error('Persisted created event missing');
      assert({
        given: 'the actual create command and its retained form identity',
        should:
          'retain selected immutable format pin and replay without a second event',
        actual: [
          created.receipt.aggregate.id,
          event.name,
          event.format.formatId,
          event.format.formatVersion,
          after.setup.events.length,
          (await send(principal, envelope)).kind,
        ],
        expected: [lobbyId, 'Created event', 'freestyle', 1, 1, 'accepted'],
      });
      const edited = new FormData();
      edited.set('name', 'Renamed event');
      edited.set('label', 'REN');
      edited.set('eventId', createId());
      const update = eventFormEnvelope(
        {
          handle: 'tournament',
          returnEventId: event.eventId,
          lobbyId,
          commandId: createId(),
          lobbyVersion: after.lobbyVersion,
          target: {
            kind: 'edit',
            eventId: event.eventId,
            ballotDefinition: null,
          },
        },
        edited,
      );
      const changed = await send(principal, update);
      const renamed = await read(principal, lobbyId);
      assert({
        given:
          'renaming through the rendered edit target with a forged editable event identity',
        should:
          'retain the persisted event identity and update its real metadata',
        actual: [
          changed.kind,
          renamed?.setup.events.map((row) => [row.eventId, row.name]),
        ],
        expected: ['accepted', [[event.eventId, 'Renamed event']]],
      });
      if (!renamed) throw new Error('Renamed authoring read missing');
      await proveEventScheduleForms({
        read,
        send,
        principal,
        lobbyId,
        eventId: event.eventId,
        handle: 'tournament',
      });
    },
  });
});
