import { authorize } from '@daisy/auth/authorization';
import { requireTestServices } from '@daisy/config';
import { createTabStore } from '@daisy/db/tab';
import { withRolledBackDatabase } from '@daisy/db/testing';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { entryEnrollmentCommand } from '../src/features/tab/operations/entry-enrollment';
import { lobbyAdministrationCommand } from '../src/features/tab/operations/lobby-administration';
import { settingCommand } from '../src/features/tab/operations/settings';
import { setupCommand } from '../src/features/tab/operations/setup';
import { as } from './tab-tournament-organization-wiring.test-support';
import { createBots, scriptClock } from './tab-tournament.test-support';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

test('a tournament’s division refuses an entrant outside it at registration, with the reason (PYL-16)', async () => {
  await withRolledBackDatabase(databaseUrl, {
    seed: (sql) => createBots(sql, ['Host', 'Adult']),
    work: async (database, bots, sql) => {
      const bot = Object.fromEntries(bots.map((one) => [one.name, one]));
      const host = bot.Host!,
        adult = bot.Adult!;
      const store = createTabStore(database);
      const common = {
        store,
        authorize,
        now: scriptClock().now,
        newId: createId,
      };
      const tournament = async (name: string) => {
        const created = await lobbyAdministrationCommand(common)(as(host), {
          version: 1,
          commandId: createId(),
          expected: {},
          command: {
            type: 'create-lobby',
            owner: { kind: 'self' },
            name,
            handle: `division-${createId()}`,
            lobby: { kind: 'tournament', admitsMinors: false },
          },
        });
        if (created.kind !== 'accepted') throw new Error('tournament refused');
        const lobbyId = created.receipt.aggregate.id;
        const added = await setupCommand(common)(as(host), {
          version: 1,
          commandId: createId(),
          expected: { lobby: created.receipt.resultingVersion },
          command: {
            type: 'add-event',
            lobbyId,
            name: 'Freestyle',
            label: 'FS',
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
          throw new Error(`event refused: ${JSON.stringify(added)}`);
        const [event] =
          await sql`select id from events where lobby_id=${lobbyId}`;
        return { lobbyId, eventId: String(event!.id) };
      };
      const settings = settingCommand(common);
      const set = async (
        scope: { readonly kind: 'lobby' | 'event'; readonly id: string },
        key: string,
        value: unknown,
      ) => {
        const [row] =
          scope.kind === 'lobby'
            ? await sql`select settings_version v from lobbies where id=${scope.id}`
            : await sql`select settings_version v from events where id=${scope.id}`;
        return settings(as(host), {
          version: 1,
          commandId: createId(),
          expected: { settings: Number(row!.v) },
          command: { type: 'set-setting', scope, key, value, hold: 'default' },
        });
      };
      // Each command leaves its own lobby in the transaction's scope; these
      // raw reads name the tournament they read.
      const inScope = (lobbyId: string) =>
        sql`select set_config('daisy.lobby_scope', ${lobbyId}, true)`;
      const enter = async (target: { lobbyId: string; eventId: string }) => {
        await inScope(target.lobbyId);
        await set({ kind: 'event', id: target.eventId }, 'entry.registration', {
          state: 'open',
        });
        await inScope(target.lobbyId);
        const [row] =
          await sql`select entries_version v from events where id=${target.eventId}`;
        return entryEnrollmentCommand(common)(as(adult), target.lobbyId, {
          version: 1,
          commandId: createId(),
          expected: { entries: Number(row!.v) },
          command: {
            type: 'submit-entry',
            eventId: target.eventId,
            name: 'Adult',
            memberActorIds: [adult.actorId],
            responsible: { kind: 'self' },
            division: null,
          },
        });
      };
      const youth = await tournament('Winter Classic');
      const division = await set(
        { kind: 'lobby', id: youth.lobbyId },
        'entry.age_division',
        { value: 'youth' },
      );
      const open = await tournament('Spring Open');
      const writtenTo = async (lobbyId: string) => {
        await inScope(lobbyId);
        const [row] =
          await sql`select count(*)::int n from entries where lobby_id=${lobbyId}`;
        return Number(row!.n);
      };
      const refusal = (answer: { kind: string; refusal?: string }) =>
        answer.kind === 'refused' ? answer.refusal : answer.kind;
      assert({
        given:
          'an adult entering a Youth tournament, and the same adult entering an Open one (the default)',
        should:
          'refuse the first as over the Youth age, with no entry written, and accept the second',
        actual: {
          division: division.kind,
          youth: refusal(await enter(youth)),
          written: await writtenTo(youth.lobbyId),
          open: refusal(await enter(open)),
        },
        expected: {
          division: 'accepted',
          youth: 'over-youth-age',
          written: 0,
          open: 'accepted',
        },
      });
    },
  });
});
