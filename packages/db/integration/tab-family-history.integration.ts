import { afterAll } from 'bun:test';
import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { sql } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  actionHistoryEntrySchema,
  commandReplay,
} from '@daisy/protocol/lobby/command';
import { appendHistory, storedCommand } from '../src/tab/command-record';
import { withScope, type TenantScope } from '../src/tenant-scope';
import { readTenantIsolationProblems } from '../src/tenant-isolation';
import {
  ddlTimeoutMs,
  scratchDatabase,
} from './scratch-migrations.test-support';
import { integrationSuite } from './suite.test-support';
import { loadSampleTournament } from './tab.test-support';
setupRitewayBun();
const { databaseUrl } = integrationSuite();
const scratch = scratchDatabase(databaseUrl, 'familyhistory');
afterAll(() => scratch.drop());
test(
  'the single journal isolates protected subjects from actors, organizations and lobbies',
  async () => {
    await scratch.create();
    await scratch.migrate(() => true);
    const client = new SQL(scratch.url, { max: 1 });
    try {
      const ids = await client.begin((tx) => loadSampleTournament(tx));
      const person = actionHistoryEntrySchema.parse({
        commandId: createId(),
        scope: { kind: 'person', subjectUserId: ids.staff },
        aggregate: { kind: 'guardian_link', id: createId() },
        type: 'create-guardian-link',
        actorUserId: ids.coach,
        authority: { kind: 'relationship', relation: 'guardian' },
        conflictId: null,
        confirmedByUserId: null,
        payloadDigest: 'a'.repeat(64),
        resultingVersion: 1,
        appliedAt: '2026-11-15T12:00:00.000Z',
      });
      const organization = {
        ...person,
        commandId: createId(),
        scope: { kind: 'organization' as const, organizationId: ids.league },
        aggregate: { kind: 'organization' as const, id: ids.league },
        type: 'update-organization',
      };
      const lobby = {
        ...person,
        commandId: createId(),
        scope: { kind: 'lobby' as const, lobbyId: ids.lobby },
        aggregate: { kind: 'lobby' as const, id: ids.lobby },
        type: 'update-lobby',
      };
      await client.unsafe('set role daisy_web');
      const database = drizzle({ client });
      for (const [entry, scope] of [
        [person, { subjectUserId: ids.staff }],
        [organization, { organizationId: ids.league }],
        [lobby, { lobbyId: ids.lobby }],
      ] as const) {
        await withScope(database, scope, (tx) =>
          appendHistory(tx, entry, {
            commandId: entry.commandId,
            aggregate: entry.aggregate,
            resultingVersion: 1,
            replayed: false,
            findings: [],
            fixtureChanges: [],
          }),
        );
      }
      const visible = (scope: TenantScope) =>
        withScope(database, scope, (tx) =>
          tx.execute(
            sql`select command_id from action_history where command_id in (${person.commandId},${organization.commandId},${lobby.commandId}) order by command_id`,
          ),
        );
      const inScope = async (scope: TenantScope) =>
        (await visible(scope)).map((row) => String(row.command_id));
      assert({
        given:
          'a protected-subject row attributed to a different actor beside real organization/lobby journal fixtures',
        should:
          'reveal only the explicitly addressed scope, without actor or organization access substituting for the protected person',
        actual: await Promise.all([
          inScope({ subjectUserId: ids.staff }),
          inScope({ subjectUserId: ids.coach }),
          inScope({ organizationId: ids.league, subjectUserId: ids.staff }),
          inScope({ lobbyId: ids.lobby, subjectUserId: ids.staff }),
          inScope({}),
        ]),
        expected: [
          [person.commandId],
          [],
          [organization.commandId],
          [lobby.commandId],
          [],
        ],
      });
      const replay = await withScope(
        database,
        { subjectUserId: ids.staff },
        async (tx) =>
          commandReplay(await storedCommand(tx, person.commandId), {
            actorUserId: ids.coach,
            payloadDigest: person.payloadDigest,
          }),
      );
      assert({
        given: 'the actual person-scoped stored command',
        should:
          'recover its original single receipt through the existing replay mechanism',
        actual:
          replay.kind === 'replay'
            ? [
                replay.receipt.commandId,
                replay.receipt.replayed,
                (await visible({ subjectUserId: ids.staff })).length,
              ]
            : replay,
        expected: [person.commandId, true, 1],
      });
      const [family] = await client`
        select has_table_privilege('daisy_web', 'guardian_links', 'INSERT') as links,
          to_regclass('public.restrictions') is null as restrictions_retired,
          has_table_privilege('daisy_web', 'restriction_lobbies', 'UPDATE') as lobby_writes
      `;
      assert({
        given: 'the web role after the guardian controls migration',
        should:
          'have link inserts and keep the remaining lobby restrictions read-only',
        actual: [
          family?.links,
          family?.restrictions_retired,
          family?.lobby_writes,
        ],
        expected: [true, true, false],
      });
      await client.unsafe('reset role');
      assert({
        given: 'the actual migrated tenant policy catalogue',
        should: 'match the strict isolation manifest including person history',
        actual: await readTenantIsolationProblems((statement) =>
          client.unsafe(statement),
        ),
        expected: [],
      });
    } finally {
      await client.close();
    }
  },
  ddlTimeoutMs,
);
