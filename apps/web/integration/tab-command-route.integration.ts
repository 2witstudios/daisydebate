import { peopleCommandEnvelope } from '../src/features/tab/organization-people-forms';
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
        hostingPlan: async () => false,
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
      const staffRole = snapshot.roles.find((role) => role.name === 'Staff');
      if (!staffRole) throw new Error('Staff preset missing');
      const selected = new FormData();
      selected.set('userId', world.bots['Judge A']!.userId);
      selected.set('roleId', staffRole.roleId);
      selected.set('scope', 'organization');
      selected.set('expiresAt', '');
      const context = {
        organizationId,
        organizationVersion: snapshot.version,
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
        grantIds: [assigned.grantId],
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
    },
  });
});
