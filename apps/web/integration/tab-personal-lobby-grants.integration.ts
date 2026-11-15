import { seedHostingGrant } from './tab-hosting-grant.test-support';
import { authorize } from '@daisy/auth/authorization';
import { requireTestServices } from '@daisy/config';
import { createTabStore } from '@daisy/db/tab';
import { withRolledBackDatabase } from '@daisy/db/testing';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { lobbyAdministrationCommand } from '../src/features/tab/operations/lobby-administration';
import { organizationCommand } from '../src/features/tab/operations/organization';
import { readTournamentSetup } from '../src/features/tab/reads/tournament-setup';
import {
  as,
  deniedAsNotFound,
  presetStaffRoleId,
} from './tab-tournament-organization-wiring.test-support';
import { createBots, scriptClock } from './tab-tournament.test-support';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
test('a personal tournament gives and removes exact lobby staff without an organization membership', async () => {
  await withRolledBackDatabase(databaseUrl, {
    seed: (sql) => createBots(sql, ['Director', 'Staff']),
    work: async (database, bots, sql) => {
      const director = bots.find((bot) => bot.name === 'Director')!,
        staff = bots.find((bot) => bot.name === 'Staff')!;
      const clock = scriptClock(),
        store = createTabStore(database),
        common = { store, authorize, now: clock.now, newId: createId };
      await seedHostingGrant(sql, director.userId);
      const create = lobbyAdministrationCommand({
        ...common,
      });
      const lobbies: string[] = [];
      for (const name of ['Personal target', 'Other personal tournament']) {
        const answer = await create(as(director), {
          version: 1,
          commandId: createId(),
          expected: {},
          command: {
            type: 'create-lobby',
            owner: { kind: 'self' },
            name,
            handle: `personal-${createId()}`,
            lobby: { kind: 'tournament', admitsMinors: false },
          },
        });
        if (answer.kind !== 'accepted')
          throw new Error('Actual personal creation refused');
        lobbies.push(answer.receipt.aggregate.id);
      }
      const lobbyId = lobbies[0]!,
        otherId = lobbies[1]!,
        read = readTournamentSetup(common);
      assert({
        given: 'a member without any organization or lobby grant',
        should: 'hide the personal host setup',
        actual: await read(as(staff), lobbyId),
        expected: null,
      });
      const send = organizationCommand({
        ...common,
      });
      const give = {
        version: 1,
        commandId: createId(),
        expected: { lobby: 1 },
        command: {
          type: 'give-grant',
          scope: { kind: 'lobby', lobbyId },
          userId: staff.userId,
          roleId: presetStaffRoleId,
          expiresAt: null,
        },
      };
      const answer = await send(as(director), give);
      assert({
        given:
          'the actual personal owner giving a preset role directly at its lobby',
        should: 'persist one lobby-guarded command',
        actual: answer.kind,
        expected: 'accepted',
      });
      if (answer.kind !== 'accepted')
        throw new Error('Actual personal grant refused');
      assert({
        given: 'the same command retried after success',
        should: 'return its original receipt',
        actual: await send(as(director), give),
        expected: { ...answer, receipt: { ...answer.receipt, replayed: true } },
      });
      const [grant] =
        await sql`select id, scope_kind, organization_id, lobby_id from grants where user_id=${staff.userId} and lobby_id=${lobbyId}`;
      const [history] =
        await sql`select organization_id, lobby_id from action_history where command_id=${give.commandId}`;
      assert({
        given: 'the stored personal grant and action receipt',
        should:
          'carry only the actual lobby scope, with no synthetic organization/membership',
        actual: [
          grant && {
            kind: grant.scope_kind,
            organization: grant.organization_id,
            lobby: grant.lobby_id,
          },
          history && {
            organization: history.organization_id,
            lobby: history.lobby_id,
          },
          (
            await sql`select organization_id from memberships where user_id=${staff.userId}`
          ).length,
        ],
        expected: [
          { kind: 'lobby', organization: null, lobby: lobbyId },
          { organization: null, lobby: lobbyId },
          0,
        ],
      });
      assert({
        given: 'the staff member reloading two actual personal tournaments',
        should:
          'authorize only the granted lobby, independently of role provenance',
        actual: [
          (await read(as(staff), lobbyId))?.lobbyId,
          await read(as(staff), otherId),
        ],
        expected: [lobbyId, null],
      });
      assert({
        given:
          'that staff member trying to give a role in the other actual lobby',
        should: 'hide the unauthorized target',
        actual: await deniedAsNotFound(() =>
          send(as(staff), {
            ...give,
            commandId: createId(),
            command: {
              ...give.command,
              scope: { kind: 'lobby', lobbyId: otherId },
            },
          }),
        ),
        expected: true,
      });
      const remove = {
        version: 1,
        commandId: createId(),
        expected: { lobby: answer.receipt.resultingVersion },
        command: {
          type: 'remove-grant',
          scope: { kind: 'lobby', lobbyId },
          grantId: String(grant?.id),
        },
      };
      const removed = await send(as(director), remove);
      assert({
        given: 'the owner removing the personal lobby grant',
        should: 'revoke the grant and refuse the next staff read',
        actual: [removed.kind, await read(as(staff), lobbyId)],
        expected: ['accepted', null],
      });
    },
  });
});
