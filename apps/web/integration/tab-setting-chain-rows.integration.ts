import { authorize } from '@daisy/auth/authorization';
import { requireTestServices } from '@daisy/config';
import { createTabStore } from '@daisy/db/tab';
import { withRolledBackDatabase } from '@daisy/db/testing';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { setupCommand } from '../src/features/tab/operations/setup';
import { settingCommand } from '../src/features/tab/operations/settings';
import { organizationStage } from './tab-tournament-organization.test-support';
import { leagueAdministrationStage } from './tab-tournament-league-administration.test-support';
import { leagueConfigurationStage } from './tab-tournament-league-configuration.test-support';
import { setupStage } from './tab-tournament-setup.test-support';
import { as } from './tab-tournament-organization-wiring.test-support';
import { createBots, scriptClock } from './tab-tournament.test-support';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
test('normal setting-chain consumers exclude sibling policies sharing their parent isolation keys', async () => {
  await withRolledBackDatabase(databaseUrl, {
    seed: (sql) =>
      createBots(sql, [
        'Director',
        'Staff',
        'Coach',
        'Judge A',
        'Debater 1',
        'Debater 2',
        'Debater 3',
        'Debater 4',
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
      await leagueConfigurationStage(world);
      await setupStage(world);
      const store = createTabStore(database);
      const send = settingCommand({
        store,
        authorize,
        now: world.clock.now,
        newId: createId,
      });
      const made = await send(as(world.bots.Director!), {
        version: 1,
        commandId: createId(),
        expected: {},
        command: {
          type: 'create-template',
          organizationId: world.made.get('league')!,
          name: 'Unoffered sibling',
          format: { id: 'freestyle', version: 1 },
          ballotDefinition: null,
        },
      });
      if (made.kind !== 'accepted')
        throw new Error('sibling template was refused');
      const templateId = made.receipt.aggregate.id;
      const set = await send(as(world.bots.Director!), {
        version: 1,
        commandId: createId(),
        expected: { settings: 1 },
        command: {
          type: 'set-setting',
          scope: { kind: 'template', id: templateId },
          key: 'entry.cap',
          value: { perEvent: 101, perSchool: null },
          hold: 'default',
        },
      });
      if (set.kind !== 'accepted')
        throw new Error(`sibling policy refused: ${JSON.stringify(set)}`);
      const eventId = world.made.get('event')!;
      await sql`select set_config('daisy.lobby_scope', ${world.made.get('tournament-lobby')!}, true)`;
      const [priorEvent] =
        await sql`select version,settings_version,entries_version from events where id=${eventId}`;
      const stopped = await send(as(world.bots.Director!), {
        version: 1,
        commandId: createId(),
        expected: {
          event: Number(priorEvent?.version),
          settings: Number(priorEvent?.settings_version),
          entries: Number(priorEvent?.entries_version),
        },
        command: { type: 'stop-following-template', eventId },
      });
      if (stopped.kind !== 'accepted')
        throw new Error(
          `Actual stop-follow refused: ${JSON.stringify(stopped)}`,
        );
      const [currentEvent] =
        await sql`select version,settings_version,entries_version from events where id=${eventId}`;
      const followed = await send(as(world.bots.Director!), {
        version: 1,
        commandId: createId(),
        expected: {
          event: Number(currentEvent?.version),
          settings: Number(currentEvent?.settings_version),
          entries: Number(currentEvent?.entries_version),
        },
        command: {
          type: 'follow-template',
          eventId,
          templateId: world.made.get('league-template')!,
        },
      });
      if (followed.kind !== 'accepted')
        throw new Error(
          `Actual template follow refused: ${JSON.stringify(followed)}`,
        );
      const lobbyId = world.made.get('tournament-lobby')!;
      const [lobby] =
        await sql`select version from lobbies where id=${lobbyId}`;
      const sibling = await setupCommand({
        store,
        authorize,
        now: world.clock.now,
        newId: createId,
      })(as(world.bots.Director!), {
        version: 1,
        commandId: createId(),
        expected: { lobby: Number(lobby?.version) },
        command: {
          type: 'add-event',
          lobbyId,
          name: 'Sibling event',
          label: 'SIB',
          entry: { kind: 'person' },
          pin: {
            kind: 'format',
            formatId: 'freestyle',
            formatVersion: 1,
            ballotDefinition: null,
          },
        },
      });
      if (sibling.kind !== 'accepted') throw new Error('Sibling event refused');
      const [otherEvent] =
        await sql`select id from events where lobby_id=${lobbyId} and name='Sibling event'`;
      const siblingEventId = String(otherEvent?.id);
      const siblingPolicy = await send(as(world.bots.Director!), {
        version: 1,
        commandId: createId(),
        expected: { settings: 1 },
        command: {
          type: 'set-setting',
          scope: { kind: 'event', id: siblingEventId },
          key: 'entry.cap',
          value: { perEvent: 202, perSchool: null },
          hold: 'default',
        },
      });
      if (siblingPolicy.kind !== 'accepted')
        throw new Error('Sibling event policy refused');
      const [stored] =
        await sql`select id from settings where template_id=${templateId} and key='entry.cap'`;
      if (!stored) throw new Error('actual sibling policy is missing');
      const standing = await store.standingRoomDraft(
        {
          viewerUserId: world.bots.Coach!.userId,
          lobbyId: world.made.get('standing-lobby')!,
        },
        async (facts) => facts,
      );
      const entrant = world.bots['Debater 1']!;
      const event = await store.entryEnrollmentCommand(
        {
          senderUserId: entrant.userId,
          lobbyId: world.made.get('tournament-lobby')!,
          now: world.clock.now(),
          newId: createId(),
          command: {
            type: 'submit-entry',
            eventId: world.made.get('event')!,
            name: 'Prospective entrant',
            memberActorIds: [entrant.actorId],
            responsible: { kind: 'self' },
            division: null,
          },
        },
        (session) => session.load(),
      );
      assert({
        given:
          'a real unoffered sibling policy whose organization_id is also the actual chain owner',
        should:
          'never load that unrelated template row into either normal consumer',
        actual: {
          standing: standing?.graph.settings.some(
            (row) => row.id === String(stored.id),
          ),
          event: event.configuration?.rows.some(
            (row) => row.id === String(stored.id),
          ),
          siblingEvent: event.configuration?.rows.some(
            (row) => row.eventId === siblingEventId,
          ),
        },
        expected: { standing: false, event: false, siblingEvent: false },
      });
      assert({
        given: 'the actual parent organization policy after narrowing',
        should: 'retain the organization-scoped setting in each real chain',
        actual: [
          standing?.graph.settings.some(
            (row) =>
              row.scopeKind === 'organization' && row.key === 'room.visibility',
          ),
          event.configuration?.rows.some(
            (row) =>
              row.scopeKind === 'organization' && row.key === 'room.visibility',
          ),
        ],
        expected: [true, true],
      });
    },
  });
});
