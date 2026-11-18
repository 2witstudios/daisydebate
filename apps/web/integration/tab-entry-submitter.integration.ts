import { requireTestServices } from '@daisy/config';
import { withRolledBackDatabase } from '@daisy/db/testing';
import { createTabStore } from '@daisy/db/tab';
import { createId } from '@paralleldrive/cuid2';
import { authorize } from '@daisy/auth/authorization';
import { errorCodeOf } from '@daisy/errors';
import { entryEnrollmentCommand } from '../src/features/tab/operations/entry-enrollment';
import { entryEnrollmentFacts } from '../src/features/tab/operations/entry-enrollment-facts';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { organizationStage } from './tab-tournament-organization.test-support';
import { leagueAdministrationStage } from './tab-tournament-league-administration.test-support';
import { setupStage } from './tab-tournament-setup.test-support';
import { entryEnrollmentStage } from './tab-tournament-entry-enrollment.test-support';
import { createBots, scriptClock } from './tab-tournament.test-support';
import { as } from './tab-tournament-organization-wiring.test-support';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
test('authenticated entry makers survive retries and approval without being replaceable', async () => {
  await withRolledBackDatabase(databaseUrl, {
    seed: (sql) =>
      createBots(sql, [
        'Director',
        'Staff',
        'Coach',
        'Debater 1',
        'Debater 2',
        'Debater 3',
        'Debater 4',
      ]),
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
      await setupStage(world);
      await entryEnrollmentStage(world);
      const eventId = world.made.get('event')!;
      const rows =
        await sql`select name, submitted_by_user_id from entries where event_id=${eventId} order by name`;
      assert({
        given:
          'four actual self-submissions in one event, each replayed and then approved by the host',
        should:
          'retain exactly one distinct authenticated maker per entry rather than the approver',
        actual: rows.map(
          (row: { name: string; submitted_by_user_id: string | null }) => ({
            name: row.name,
            maker: row.submitted_by_user_id,
          }),
        ),
        expected: ['Debater 1', 'Debater 2', 'Debater 3', 'Debater 4'].map(
          (name) => ({ name, maker: world.bots[name]!.userId }),
        ),
      });
      const command = {
        type: 'accept-entry',
        entryId: world.made.get('Debater 1')!,
      } as const;
      const input = {
        commandId: createId(),
        newEntryId: createId(),
        now: world.clock.now(),
        senderUserId: world.bots.Director!.userId,
        host: true,
        command,
      };
      const loadedMaker = await createTabStore(database).entryEnrollmentCommand(
        {
          lobbyId: world.made.get('tournament-lobby')!,
          senderUserId: input.senderUserId,
          command,
          newId: input.newEntryId,
          now: input.now,
        },
        async (session) =>
          entryEnrollmentFacts(await session.load(), input).entry
            ?.submittedByUserId,
      );
      assert({
        given:
          'the current fenced enrollment loader and facts mapper after host approval',
        should:
          'load the persisted maker directly without reconstructing event history',
        actual: loadedMaker,
        expected: world.bots['Debater 1']!.userId,
      });
      for (const replacement of [world.bots.Director!.userId, null]) {
        let refused = false;
        try {
          await sql.savepoint(async (child) => {
            await child`update entries set submitted_by_user_id=${replacement} where id=${world.made.get('Debater 1')!}`;
          });
        } catch (error) {
          refused =
            typeof error === 'object' &&
            error !== null &&
            'constraint' in error &&
            error.constraint === 'entries_submitter_immutable';
        }
        assert({
          given: 'a direct attempt to replace or remove the recorded maker',
          should: 'refuse the immutable provenance change',
          actual: refused,
          expected: true,
        });
      }
      const [after] =
        await sql`select submitted_by_user_id from entries where id=${world.made.get('Debater 1')!}`;
      assert({
        given: 'refused provenance mutations',
        should: 'leave the original maker unchanged',
        actual: after?.submitted_by_user_id,
        expected: world.bots['Debater 1']!.userId,
      });
      const forgedCommandId = createId();
      let forged = 'accepted';
      try {
        await entryEnrollmentCommand({
          store: createTabStore(database),
          authorize,
          now: world.clock.now,
          newId: createId,
        })(as(world.bots['Debater 1']!), world.made.get('tournament-lobby')!, {
          version: 1,
          commandId: forgedCommandId,
          expected: { entries: Number(world.made.get('entries-version')) },
          command: {
            type: 'submit-entry',
            eventId,
            name: 'Forged maker',
            memberActorIds: [world.bots['Debater 1']!.actorId],
            responsible: { kind: 'self' },
            division: null,
            submittedByUserId: world.bots.Director!.userId,
          },
        });
      } catch (error) {
        forged = errorCodeOf(error, 'INTERNAL');
      }
      assert({
        given: 'a client supplying its own maker field',
        should: 'reject the input without an entry or history receipt',
        actual: [
          forged,
          (
            await sql`select command_id from action_history where command_id=${forgedCommandId}`
          ).length,
          (
            await sql`select id from entries where event_id=${eventId} and name='Forged maker'`
          ).length,
        ],
        expected: ['VALIDATION', 0, 0],
      });

      // Historical unknown fixture, not a claim that the application submits without a maker.
      const unknownId = createId();
      await sql`insert into entries (id, lobby_id, event_id, name, status, responsible_kind)
        values (${unknownId}, ${world.made.get('tournament-lobby')!}, ${eventId}, 'Unknown historical maker', 'withdrawn', 'self')`;
      const unknownCommand = {
        type: 'accept-entry',
        entryId: unknownId,
      } as const;
      const unknownMaker = await createTabStore(
        database,
      ).entryEnrollmentCommand(
        {
          lobbyId: world.made.get('tournament-lobby')!,
          senderUserId: input.senderUserId,
          command: unknownCommand,
          newId: createId(),
          now: input.now,
        },
        async (session) =>
          entryEnrollmentFacts(await session.load(), {
            ...input,
            command: unknownCommand,
          }).entry?.submittedByUserId,
      );
      let retcon = false;
      try {
        await sql.savepoint(async (child) => {
          await child`update entries set submitted_by_user_id=${world.bots.Director!.userId} where id=${unknownId}`;
        });
      } catch (error) {
        retcon =
          typeof error === 'object' &&
          error !== null &&
          'constraint' in error &&
          error.constraint === 'entries_submitter_immutable';
      }
      assert({
        given:
          'an existing entry with unknown maker beside known submissions in the same event',
        should: 'load explicit unknown and reject a fabricated maker',
        actual: [unknownMaker, retcon],
        expected: [null, true],
      });
    },
  });
});
