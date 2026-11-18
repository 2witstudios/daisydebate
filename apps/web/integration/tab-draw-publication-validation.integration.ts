import { authorize } from '@daisy/auth/authorization';
import { requireTestServices } from '@daisy/config';
import { createTabStore } from '@daisy/db/tab';
import { withRolledBackDatabase } from '@daisy/db/testing';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { decideDraw } from '../src/features/tab/commands/draw';
import { drawFacts } from '../src/features/tab/operations/draw-facts';
import { tabEngine } from '../src/features/tab/operations/tab-engine';
import { drawCommand } from '../src/features/tab/operations/draw-command';
import {
  draftDrawStage,
  firstDrawCompetition,
} from './tab-tournament-draw-draft.test-support';
import { organizationStage } from './tab-tournament-organization.test-support';
import { leagueAdministrationStage } from './tab-tournament-league-administration.test-support';
import { setupStage } from './tab-tournament-setup.test-support';
import { entryEnrollmentStage } from './tab-tournament-entry-enrollment.test-support';
import { judgeRegistrationStage } from './tab-tournament-judge-registration.test-support';
import { as } from './tab-tournament-organization-wiring.test-support';
import { createBots, scriptClock } from './tab-tournament.test-support';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
test('the publication decider assesses actual locked draft children from real edits', async () => {
  await withRolledBackDatabase(databaseUrl, {
    seed: (sql) =>
      createBots(sql, [
        'Director',
        'Staff',
        'Coach',
        'Judge A',
        'Judge B',
        'Judge C',
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
      for (const stage of [
        organizationStage,
        leagueAdministrationStage,
        setupStage,
        entryEnrollmentStage,
        judgeRegistrationStage,
        draftDrawStage,
      ])
        await stage(world);
      const lobbyId = world.made.get('tournament-lobby')!,
        originalDraw = world.made.get('draw')!,
        store = createTabStore(database);
      const fixtures =
        await sql`select df.fixture_id from draw_fixtures df where df.draw_id=${originalDraw} order by df.fixture_id`;
      const [moving] =
        await sql`select entry_id from fixture_entries where fixture_id=${fixtures[1]!.fixture_id} order by position limit 1`;
      const edited = await drawCommand({
        store,
        authorize,
        now: world.clock.now,
        newId: createId,
        competition: firstDrawCompetition,
      })(as(world.bots.Director!), lobbyId, {
        version: 1,
        commandId: createId(),
        expected: { draw: 1 },
        command: {
          type: 'edit-draw',
          basedOnDrawId: originalDraw,
          edits: [
            {
              type: 'move-entry',
              entryId: String(moving!.entry_id),
              toFixtureId: String(fixtures[0]!.fixture_id),
              position: 2,
            },
          ],
        },
      });
      if (edited.kind !== 'accepted')
        throw new Error(
          `Expected actual typed edit: ${JSON.stringify(edited)}`,
        );
      const command = {
        type: 'publish-draw' as const,
        drawId: edited.receipt.aggregate.id,
        overrides: [
          {
            key: 'pairing.rematch' as const,
            reason: 'This cannot repair structure',
          },
        ],
      };
      const decision = await store.drawCommand(
        { senderUserId: world.bots.Director!.userId, lobbyId, command },
        async (session) => {
          const loaded = await session.load();
          if (!loaded) throw new Error('Current draft is missing');
          const facts = drawFacts(loaded, firstDrawCompetition(loaded), {
            commandId: createId(),
            now: world.clock.now(),
            newId: createId,
          });
          return decideDraw(tabEngine)(facts, command);
        },
      );
      const [counts] =
        await sql`select (select count(*)::int from rooms where lobby_id=${lobbyId}) rooms,(select count(*)::int from releases where lobby_id=${lobbyId}) releases,(select count(*)::int from action_history where lobby_id=${lobbyId} and type='publish-draw') history`;
      assert({
        given:
          'a real malformed three-entry pairing persisted by the actual draft edit, assessed under canonical command fences',
        should:
          'refuse the current structure despite a rule override and produce no publication writes',
        actual: [
          decision.kind === 'refused' ? decision.refusal : 'accepted',
          counts?.rooms,
          counts?.releases,
          counts?.history,
        ],
        expected: ['draw-unresolved', 0, 0, 0],
      });
    },
  });
});
