import { authorize } from '@daisy/auth/authorization';
import { requireTestServices } from '@daisy/config';
import { createTabStore } from '@daisy/db/tab';
import { withRolledBackDatabase } from '@daisy/db/testing';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { sanctionCommand } from '../src/features/tab/operations/sanction-command';
import { createBots, scriptClock } from './tab-tournament.test-support';
import {
  as,
  deniedAsNotFound,
} from './tab-tournament-organization-wiring.test-support';
import { requireAccepted } from './league-membership-competition.test-support';
import {
  sanctionRegressionFixture,
  sanctionRegressionNames,
} from './sanction-regression.test-support';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
test('a distinct personal event host withdraws with its actual lobby authority and one replayable journal entry', async () => {
  await withRolledBackDatabase(databaseUrl, {
    seed: (sql) => createBots(sql, sanctionRegressionNames),
    work: async (database, bots, sql) => {
      const world = {
        database,
        sql,
        bots: Object.fromEntries(bots.map((bot) => [bot.name, bot])),
        clock: scriptClock(Date.now()),
        made: new Map<string, string>(),
      };
      const fixture = await sanctionRegressionFixture(world);
      const send = sanctionCommand({
        store: createTabStore(database),
        authorize,
        newId: createId,
      });
      const withdrawn = await requireAccepted(
        send(as(fixture.host), fixture.input, fixture.withdrawal),
        'host withdraws league-approved sanction',
      );
      const replay = await send(
        as(fixture.host),
        fixture.input,
        fixture.withdrawal,
      );
      const rows =
        await sql`select command_id,actor_user_id,organization_id,lobby_id,authority,grant_id,aggregate_kind,aggregate_id,type from action_history where command_id in (${fixture.request.commandId},${fixture.approval.commandId},${fixture.withdrawal.commandId})`;
      const actual = Object.fromEntries(
        rows.map((row: { command_id: string }) => [row.command_id, row]),
      );
      const row = (
        commandId: string,
        actorUserId: string,
        scope: 'lobby' | 'organization',
        type: string,
      ) => ({
        command_id: commandId,
        actor_user_id: actorUserId,
        organization_id:
          scope === 'organization' ? fixture.organizationId : null,
        lobby_id: scope === 'lobby' ? fixture.lobbyId : null,
        authority: 'owner',
        grant_id: null,
        aggregate_kind: 'sanction',
        aggregate_id: fixture.sanctionId,
        type,
      });
      assert({
        given:
          'a personal host and separate league director before certification',
        should: 'withdraw at version three and replay the same receipt',
        actual: [withdrawn.resultingVersion, replay],
        expected: [
          3,
          { kind: 'accepted', receipt: { ...withdrawn, replayed: true } },
        ],
      });
      assert({
        given:
          'actual host request, league approval and host withdrawal plus retry',
        should:
          'retain exactly the proper authority and scope for each of three single-history entries',
        actual: [rows.length, actual],
        expected: [
          3,
          {
            [fixture.request.commandId]: row(
              fixture.request.commandId,
              fixture.host.userId,
              'lobby',
              'request-sanction',
            ),
            [fixture.approval.commandId]: row(
              fixture.approval.commandId,
              fixture.director.userId,
              'organization',
              'approve-sanction',
            ),
            [fixture.withdrawal.commandId]: row(
              fixture.withdrawal.commandId,
              fixture.host.userId,
              'lobby',
              'withdraw-sanction',
            ),
          },
        ],
      });
    },
  });
}, 30000);
test('league setup-only authority cannot substitute for actual personal event-host authority', async () => {
  await withRolledBackDatabase(databaseUrl, {
    seed: (sql) => createBots(sql, sanctionRegressionNames),
    work: async (database, bots, sql) => {
      const world = {
        database,
        sql,
        bots: Object.fromEntries(bots.map((bot) => [bot.name, bot])),
        clock: scriptClock(Date.now()),
        made: new Map<string, string>(),
      };
      const fixture = await sanctionRegressionFixture(world);
      const send = sanctionCommand({
        store: createTabStore(database),
        authorize,
        newId: createId,
      });
      const denied = await deniedAsNotFound(() =>
        send(as(fixture.setupOnly), fixture.input, fixture.withdrawal),
      );
      const [sanction] =
        await sql`select status,version from sanctions where id=${fixture.sanctionId}`;
      const journal =
        await sql`select command_id from action_history where command_id=${fixture.withdrawal.commandId}`;
      assert({
        given:
          'an active league member with a real organization-scoped grant containing only lobby.setup.manage, no organization.manage and no personal-event grant',
        should:
          'deny withdrawal without changing sanction or appending history',
        actual: [denied, sanction, journal.length],
        expected: [true, { status: 'approved', version: 2 }, 0],
      });
    },
  });
}, 30000);
