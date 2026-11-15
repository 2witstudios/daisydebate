import { authorize } from '@daisy/auth/authorization';
import { requireTestServices } from '@daisy/config';
import { createTabStore, type TabStore } from '@daisy/db/tab';
import { withRolledBackDatabase } from '@daisy/db/testing';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { organizationCommand } from '../src/features/tab/operations/organization';
import { judgeRegistrationCommand } from '../src/features/tab/operations/judge-registration';
import { organizationStage } from './tab-tournament-organization.test-support';
import { leagueAdministrationStage } from './tab-tournament-league-administration.test-support';
import {
  as,
  deniedAsNotFound,
} from './tab-tournament-organization-wiring.test-support';
import { createBots, scriptClock } from './tab-tournament.test-support';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
test('a grant expiring while facts load cannot authorize at request arrival time', async () => {
  await withRolledBackDatabase(databaseUrl, {
    seed: (sql) => createBots(sql, ['Director', 'Staff', 'Coach', 'Judge A']),
    work: async (database, bots, sql) => {
      const world = {
        database,
        sql,
        clock: scriptClock(),
        bots: Object.fromEntries(bots.map((bot) => [bot.name, bot])),
        made: new Map<string, string>(),
      };
      await organizationStage(world);
      await leagueAdministrationStage(world);
      const leagueId = world.made.get('league')!;
      const staff = world.bots.Staff!;
      // This proof needs a tournament owned by the league so Staff's real org grant applies.
      await sql.unsafe('reset role');
      const tournamentId = createId();
      await sql`insert into lobbies (id, handle, name, kind, owner_organization_id) values (${tournamentId}, ${`expiry-${tournamentId}`}, 'Expiry tournament', 'tournament', ${leagueId})`;
      await sql`insert into tournaments (lobby_id, status, admits_minors) values (${tournamentId}, 'draft', false)`;

      await sql.unsafe('set local role daisy_web');
      const original = createTabStore(database);
      const organization = organizationCommand({
        store: original,
        authorize,
        now: world.clock.now,
        newId: createId,
      });
      const [active] =
        await sql`select id, role_id from grants where organization_id = ${leagueId} and user_id = ${staff.userId} and revoked_at is null`;
      const [version] =
        await sql`select version from organizations where id = ${leagueId}`;
      const revoke = await organization(as(world.bots.Director!), {
        version: 1,
        commandId: createId(),
        expected: { organization: Number(version?.version) },
        command: {
          type: 'remove-grant',
          grantId: String(active?.id),
          scope: { kind: 'organization', organizationId: leagueId },
        },
      });
      if (revoke.kind !== 'accepted')
        throw new Error('expiry proof could not revoke original grant');
      const grant = await organization(as(world.bots.Director!), {
        version: 1,
        commandId: createId(),
        expected: { organization: revoke.receipt.resultingVersion },
        command: {
          type: 'give-grant',
          userId: staff.userId,
          roleId: String(active?.role_id),
          scope: { kind: 'organization', organizationId: leagueId },
          expiresAt: new Date(
            Date.parse(world.clock.now()) + 60_000,
          ).toISOString(),
        },
      });
      if (grant.kind !== 'accepted')
        throw new Error('expiry proof could not grant expiring authority');

      const delayed: Pick<TabStore, 'judgeRegistrationCommand'> = {
        judgeRegistrationCommand: (input, work) =>
          original.judgeRegistrationCommand(input, (session) =>
            work({
              ...session,
              load: async () => {
                const loaded = await session.load();
                world.clock.advance(2);
                return loaded;
              },
            }),
          ),
      };
      const arrival = world.clock.now();
      let staleAllowed = false;
      const send = judgeRegistrationCommand({
        store: delayed,
        authorize: (input) => {
          staleAllowed = authorize({
            ...input,
            context: { ...input.context, now: arrival },
          }).allow;
          return authorize(input);
        },
        now: world.clock.now,
        newId: createId,
        minorsReleased: async () => false,
      });
      assert({
        given:
          'a real grant valid at arrival but expired after the fenced facts load',
        should: 'deny the command using the post-load instant',
        actual: await deniedAsNotFound(() =>
          send(as(staff), tournamentId, {
            version: 1,
            commandId: createId(),
            expected: {},
            command: {
              type: 'invite-judge',
              actorId: world.bots['Judge A']!.actorId,
              schoolOrganizationId: null,
              chairQualified: true,
            },
          }),
        ),
        expected: true,
      });
      assert({
        given:
          'the same persisted grant evaluated at the stale arrival instant',
        should: 'expose the negative control',
        actual: staleAllowed,
        expected: true,
      });
      const [count] =
        await sql`select count(*)::int as count from tournament_judges where lobby_id = ${tournamentId}`;
      assert({
        given: 'the denied invitation',
        should: 'write no judge',
        actual: count?.count,
        expected: 0,
      });
    },
  });
});
