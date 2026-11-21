import { leagueAdministrationStage } from './tab-tournament-league-administration.test-support';
import { requireTestServices } from '@daisy/config';
import { authorize } from '@daisy/auth/authorization';
import { createTabStore } from '@daisy/db/tab';
import { withRolledBackDatabase } from '@daisy/db/testing';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { organizationStage } from './tab-tournament-organization.test-support';
import { lobbyAdministrationCommand } from '../src/features/tab/operations/lobby-administration';
import { as } from './tab-tournament-organization-wiring.test-support';

import { createBots, scriptClock } from './tab-tournament.test-support';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

test('league lobby administration persists under its tenant fence', async () => {
  await withRolledBackDatabase(databaseUrl, {
    seed: (sql) => createBots(sql, ['Director', 'Staff', 'Coach']),
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
    },
  });
});

test('a standing lobby owns its age rule independently of the league’s legacy division', async () => {
  const organizationId = createId();
  await withRolledBackDatabase(databaseUrl, {
    seed: async (sql) => {
      const [director] = await createBots(sql, ['Director']);
      await sql`insert into organizations (id, kind, name, handle, owner_user_id, league_division)
        values (${organizationId}, 'league', 'Youth league', ${organizationId}, ${director!.userId}, 'youth')`;
      return director!;
    },
    work: async (database, director, sql) => {
      const create = lobbyAdministrationCommand({
        store: createTabStore(database),
        authorize,
        now: scriptClock().now,
        newId: createId,
      });
      const rules = [];
      for (const ageRule of [undefined, 'anyone', 'under-18'] as const) {
        const handle = createId();
        const reply = await create(as(director), {
          version: 1,
          commandId: createId(),
          expected: {},
          command: {
            type: 'create-lobby',
            owner: { kind: 'organization', organizationId },
            name: handle,
            handle,
            lobby: { kind: 'standing', ...(ageRule ? { ageRule } : {}) },
          },
        });
        if (reply.kind !== 'accepted') throw new Error(JSON.stringify(reply));
        const [row] =
          await sql`select age_rule from lobbies where id=${reply.receipt.aggregate.id}`;
        rules.push(row?.age_rule);
      }
      assert({
        given:
          'three new standing lobbies in a league with the legacy Youth division',
        should: 'persist the default or each lobby’s explicit age rule',
        actual: rules,
        expected: ['adults', 'anyone', 'under-18'],
      });
    },
  });
});
