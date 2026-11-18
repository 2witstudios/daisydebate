import { peopleCommandEnvelope } from '../src/features/tab/organization-people-forms';
import { createOwnedTournament } from './tab-tournament-owned-event.test-support';
import { readTournamentSetup } from '../src/features/tab/reads/tournament-setup';
import { readOrganizationPeople } from '../src/features/tab/reads/organization-people';
import type { TabStore } from '@daisy/db/tab';
import { as } from './tab-tournament-organization-wiring.test-support';
import { authorize } from '@daisy/auth/authorization';
import { requireTestServices } from '@daisy/config';
import { createTabStore } from '@daisy/db/tab';
import { withRolledBackDatabase } from '@daisy/db/testing';
import { noopErrorReporter } from '@daisy/observability';
import { lobbyCommandReceiptSchema } from '@daisy/protocol/lobby/command';
import { createId } from '@paralleldrive/cuid2';
import { z } from 'zod';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createTabCommandRoute } from '../src/features/tab/command-route';
import { organizationCommand } from '../src/features/tab/operations/organization';
import { silentLogger } from '../src/server/test-loggers.test-support';
import { origin } from '../src/server/member-boundary.test-support';
import { organizationStage } from './tab-tournament-organization.test-support';
import {
  createBots,
  scriptClock,
  type Bot,
} from './tab-tournament.test-support';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
test('the HTTP command boundary runs the real tenant-fenced membership operation and its replay', async () => {
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
      const execute = organizationCommand({
        store: createTabStore(database),
        authorize,
        now: world.clock.now,
        newId: createId,
      });
      const route = (person: Bot, released = true) =>
        createTabCommandRoute({
          boundary: {
            logger: silentLogger,
            reporter: noopErrorReporter,
            origin: () => origin,
            identify: async () => ({
              state: 'member',
              username: person.name,
              principal: {
                kind: 'user',
                userId: person.userId,
                actorId: person.actorId,
              },
            }),
          },
          name: 'tab.organization.command',
          address: 'none',
          released: async () => released,
          execute,
        });
      const organizationId = world.made.get('league')!;
      const [organization] =
        await sql`select version from organizations where id=${organizationId}`;
      const invitation = {
        version: 1,
        commandId: createId(),
        expected: { organization: Number(organization?.version) },
        command: {
          type: 'invite-member',
          organizationId,
          userId: world.bots['Judge A']!.userId,
        },
      };
      const request = (body: unknown) =>
        new Request(`${origin}/api/tab/organization-command`, {
          method: 'POST',
          headers: { origin, 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
      const missing = {
        ...invitation,
        commandId: createId(),
        command: { ...invitation.command, userId: createId() },
      };
      const missingAnswer = await route(world.bots.Director!)(request(missing));
      const [unchanged] =
        await sql`select version from organizations where id=${organizationId}`;
      const [missingHistory] =
        await sql`select count(*)::int as count from action_history where command_id=${missing.commandId}`;
      assert({
        given: 'a valid command id naming a person who does not exist',
        should:
          'answer not found and roll back the organization guard and journal',
        actual: [
          missingAnswer.status,
          unchanged?.version,
          missingHistory?.count,
        ],
        expected: [404, organization?.version, 0],
      });
      const denied = await route(world.bots.Coach!)(request(invitation));
      const hidden = await route(
        world.bots.Director!,
        false,
      )(request(invitation));
      const accepted = await route(world.bots.Director!)(request(invitation));
      const replayed = await route(world.bots.Director!)(request(invitation));
      const receipt = z.object({
        kind: z.literal('accepted'),
        receipt: lobbyCommandReceiptSchema,
      });
      const original = receipt.parse(await accepted.json());
      const replay = receipt.parse(await replayed.json());
      const [member] =
        await sql`select status from memberships where organization_id=${organizationId} and user_id=${world.bots['Judge A']!.userId}`;
      const [journal] =
        await sql`select count(*)::int as count from action_history where command_id=${invitation.commandId}`;
      assert({
        given:
          'an unprivileged caller, a closed release, and the actual owner retrying one invitation',
        should:
          'deny the first two, store exactly one pending membership and replay the receipt',
        actual: [
          denied.status,
          hidden.status,
          accepted.status,
          replayed.status,
          member?.status,
          journal?.count,
          replay.receipt,
        ],
        expected: [
          404,
          404,
          200,
          200,
          'invited',
          1,
          { ...original.receipt, replayed: true },
        ],
      });
      const answerMembership = await route(world.bots['Judge A']!)(
        request({
          version: 1,
          commandId: createId(),
          expected: { organization: original.receipt.resultingVersion },
          command: { type: 'accept-membership', organizationId },
        }),
      );
      if (answerMembership.status !== 200)
        throw new Error('the invited person could not accept');
      const read = readOrganizationPeople({
        store: createTabStore(database),
        authorize,
        now: world.clock.now,
      });
      const snapshot = await read(as(world.bots.Director!), organizationId);
      if (!snapshot) throw new Error('owner people snapshot missing');
      const staffRole = snapshot.roles.find((role) =>
        role.permissions.includes('organization.roles.manage'),
      );
      if (!staffRole) throw new Error('Actual people-management role missing');
      if (!staffRole) throw new Error('Staff preset missing');
      const selected = new FormData();
      selected.set('userId', world.bots['Judge A']!.userId);
      selected.set('roleId', staffRole.roleId);
      selected.set('scope', 'organization');
      selected.set('expiresAt', '');
      const context = {
        organizationId,
        organizationVersion: snapshot.version,
        lobbies: snapshot.lobbies,
        handle: 'league',
        commandId: createId(),
        intent: 'give',
      } as const;
      const given = await route(world.bots.Director!)(
        request(peopleCommandEnvelope(context, selected)),
      );
      const stale = await route(world.bots.Director!)(
        request(
          peopleCommandEnvelope(
            { ...context, commandId: createId() },
            selected,
          ),
        ),
      );
      const givenBody = receipt.parse(await given.json());
      const after = await read(as(world.bots.Director!), organizationId);
      const assigned = after?.people.find(
        (person) => person.userId === world.bots['Judge A']!.userId,
      )?.grants[0];
      assert({
        given: 'the role form bound to the people snapshot the host saw',
        should:
          'give the real preset and refuse a different action from the obsolete snapshot',
        actual: [
          given.status,
          z
            .object({ kind: z.string(), refusal: z.string() })
            .parse(await stale.json()),
          after?.version,
          assigned?.roleId,
        ],
        expected: [
          200,
          { kind: 'refused', refusal: 'version-conflict' },
          snapshot.version + 1,
          staffRole.roleId,
        ],
      });
      if (!after || !assigned)
        throw new Error('the assigned role is absent from the live read');
      const end = {
        ...context,
        commandId: createId(),
        organizationVersion: after.version,
        intent: 'remove',
        lobbies: after.lobbies,
        grants: [{ grantId: assigned.grantId, scope: assigned.scope }],
      } as const;
      const endFields = new FormData();
      endFields.set('grantId', assigned.grantId);
      const ended = await route(world.bots.Director!)(
        request(peopleCommandEnvelope(end, endFields)),
      );
      const endedBody = receipt.parse(await ended.json());
      const [storedGrant] =
        await sql`select revoked_at from grants where id=${assigned.grantId}`;
      assert({
        given: 'the selected live grant ended through its bound form',
        should: 'revoke that exact grant and move the organization guard once',
        actual: [
          ended.status,
          storedGrant?.revoked_at !== null,
          endedBody.receipt.resultingVersion,
        ],
        expected: [200, true, givenBody.receipt.resultingVersion + 1],
      });
      const expiring = new FormData();
      for (const [key, value] of selected.entries()) expiring.set(key, value);
      expiring.set(
        'expiresAt',
        new Date(Date.parse(world.clock.now()) + 60_000)
          .toISOString()
          .slice(0, 16),
      );
      const expires = await route(world.bots.Director!)(
        request(
          peopleCommandEnvelope(
            {
              ...context,
              commandId: createId(),
              organizationVersion: endedBody.receipt.resultingVersion,
            },
            expiring,
          ),
        ),
      );
      if (expires.status !== 200) throw new Error('expiring role form failed');
      const arrival = world.clock.now();
      let staleAllowed = false;
      const originalStore = createTabStore(database);
      const delayed: Pick<TabStore, 'organizationPeople'> = {
        organizationPeople: (input, work) =>
          originalStore.organizationPeople(input, async (facts) => {
            world.clock.advance(2);
            return work(facts);
          }),
      };
      const delayedRead = readOrganizationPeople({
        store: delayed,
        now: world.clock.now,
        authorize: (input) => {
          staleAllowed ||= authorize({
            ...input,
            context: { ...input.context, now: arrival },
          }).allow;
          return authorize(input);
        },
      });
      assert({
        given:
          'the real role expiring while its people snapshot is being loaded',
        should:
          'deny the read at its post-load instant while the arrival-time control would allow it',
        actual: [
          await delayedRead(as(world.bots['Judge A']!), organizationId),
          staleAllowed,
        ],
        expected: [null, true],
      });
      const owned = await createOwnedTournament(world);
      const lobbySnapshot = await read(
        as(world.bots.Director!),
        organizationId,
      );
      if (!lobbySnapshot) throw new Error('Lobby grant snapshot is missing');
      const lobbyFields = new FormData();
      lobbyFields.set('userId', world.bots.Coach!.userId);
      lobbyFields.set('roleId', staffRole.roleId);
      lobbyFields.set('scope', owned.lobbyId);
      lobbyFields.set('expiresAt', '');
      const lobbyContext = {
        ...context,
        commandId: createId(),
        organizationVersion: lobbySnapshot.version,
        lobbies: lobbySnapshot.lobbies,
      };
      const lobbyGiven = await route(world.bots.Director!)(
        request(peopleCommandEnvelope(lobbyContext, lobbyFields)),
      );
      const lobbyAnswer = receipt.parse(await lobbyGiven.json());
      const afterLobby = await read(as(world.bots.Director!), organizationId);
      const lobbyGrant = afterLobby?.people
        .find((person) => person.userId === world.bots.Coach!.userId)
        ?.grants.find(
          (grant) =>
            grant.scope.kind === 'lobby' &&
            grant.scope.lobbyId === owned.lobbyId,
        );
      const staleLobby = await route(world.bots.Director!)(
        request(
          peopleCommandEnvelope(
            { ...lobbyContext, commandId: createId() },
            lobbyFields,
          ),
        ),
      );
      const setup = readTournamentSetup({
        store: createTabStore(database),
        authorize,
        now: world.clock.now,
      });
      assert({
        given:
          'a real lobby role form bound to the organization people snapshot',
        should:
          'move only its displayed lobby guard, refuse stale retry under a new id, and authorize its actual recipient',
        actual: [
          lobbyGiven.status,
          lobbyAnswer.receipt.aggregate,
          afterLobby?.version,
          afterLobby?.lobbies.find((lobby) => lobby.lobbyId === owned.lobbyId)
            ?.version,
          await staleLobby.json(),
          (await setup(as(world.bots.Coach!), owned.lobbyId))?.lobbyId,
        ],
        expected: [
          200,
          { kind: 'lobby', id: owned.lobbyId },
          lobbySnapshot.version,
          owned.version + 1,
          { kind: 'refused', refusal: 'version-conflict' },
          owned.lobbyId,
        ],
      });
      if (!afterLobby || !lobbyGrant)
        throw new Error('Actual lobby grant is missing');
      const removalFields = new FormData();
      removalFields.set('grantId', lobbyGrant.grantId);
      const lobbyEnded = await route(world.bots.Director!)(
        request(
          peopleCommandEnvelope(
            {
              ...lobbyContext,
              commandId: createId(),
              lobbies: afterLobby.lobbies,
              intent: 'remove',
              grants: [
                { grantId: lobbyGrant.grantId, scope: lobbyGrant.scope },
              ],
            },
            removalFields,
          ),
        ),
      );
      assert({
        given:
          'removal bound to the actual displayed lobby grant and its new guard',
        should: 'revoke only that target and remove host access on reload',
        actual: [
          lobbyEnded.status,
          (await lobbyEnded.json()).kind,
          await setup(as(world.bots.Coach!), owned.lobbyId),
        ],
        expected: [200, 'accepted', null],
      });
    },
  });
});
