import { SQL } from 'bun';
import { sql as query } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sql';
import { createId } from '@paralleldrive/cuid2';
import { assert, test } from 'riteway/bun';
import { tenantIsolationManifest } from '../src/tenant-isolation-manifest';
import { withScope } from '../src/tenant-scope';
import { integrationSuite } from './suite.test-support';
import {
  asRuntime,
  inRolledBackTransaction,
  insertRow,
  loadSampleTournament,
  refusedBy,
} from './tab.test-support';

const { databaseUrl: url } = integrationSuite();

const rows = async (sql: SQL, statement: string, values: unknown[] = []) =>
  (
    (await sql.unsafe(
      `select count(*)::int as rows from (${statement}) counted`,
      values,
    )) as Array<{ rows: number }>
  )[0]!.rows;

/** How many rows a data-changing statement reached. */
const changed = async (sql: SQL, statement: string, values: unknown[] = []) =>
  (
    (await sql.unsafe(
      `with changed as (${statement} returning 1) select count(*)::int as rows from changed`,
      values,
    )) as Array<{ rows: number }>
  )[0]!.rows;

/** The tables whose rows only a scope opens: no open read. */
const closedTables = tenantIsolationManifest.tables
  .filter((entry) => !entry.openRead)
  .map((entry) => entry.table);

/** TAB-4.3: with no scope the fence fails closed. */
test('the runtime role with no scope reads no row of any scoped table and writes none', async () => {
  await inRolledBackTransaction(url, async (sql) => {
    const ids = await loadSampleTournament(sql);
    const counts = async () =>
      Object.fromEntries(
        await Promise.all(
          closedTables.map(
            async (table) =>
              [table, await rows(sql, `select 1 from ${table}`)] as const,
          ),
        ),
      );
    const asOwner = await counts();
    const unscoped = await asRuntime(sql, {}, async () => ({
      visible: Object.entries(await counts())
        .filter(([, count]) => count > 0)
        .map(([table]) => table),
      insert: await refusedBy(sql, () =>
        insertRow(sql, 'time_slots', {
          id: createId(),
          lobby_id: ids.lobby,
          name: 'Unscoped',
          starts_at: new Date(),
        }),
      ),
      updated: await changed(sql, `update time_slots set name = name || '!'`),
      deleted: await changed(sql, 'delete from judge_strikes'),
    }));
    assert({
      given: 'the sample tournament and the runtime role with no scope set',
      should:
        'see no row of any scoped table the sample filled, and insert, update and delete none',
      actual: {
        // Of the 38 such tables; the rest are the closed guardian tables
        // and ballot screenings, which the sample does not fill.
        filledBySample: Object.values(asOwner).filter((count) => count > 0)
          .length,
        ...unscoped,
      },
      expected: {
        filledBySample: 34,
        visible: [],
        insert: '42501',
        updated: 0,
        deleted: 0,
      },
    });
  });
});

test("one lobby's scope reaches neither another lobby's rows nor its owning organization's", async () => {
  await inRolledBackTransaction(url, async (sql) => {
    const ids = await loadSampleTournament(sql);
    const reach = () =>
      Promise.all([
        rows(sql, 'select 1 from events where lobby_id = $1', [ids.lobby]),
        rows(sql, 'select 1 from results where lobby_id = $1', [ids.lobby]),
        rows(sql, 'select 1 from memberships where organization_id = $1', [
          ids.league,
        ]),
        rows(sql, 'select 1 from season_standing_rules where season_id = $1', [
          ids.season,
        ]),
      ]);
    const own = await asRuntime(sql, { lobbyId: ids.lobby }, reach);
    const other = await asRuntime(
      sql,
      { lobbyId: ids.otherLobby },
      async () => ({
        reach: await reach(),
        write: await refusedBy(sql, () =>
          insertRow(sql, 'time_slots', {
            id: createId(),
            lobby_id: ids.lobby,
            name: 'From another lobby',
            starts_at: new Date(),
          }),
        ),
      }),
    );
    const league = await asRuntime(sql, { organizationId: ids.league }, reach);
    assert({
      given:
        "the sample tournament read under its own lobby's scope, another lobby's, and its owning league's",
      should:
        "open the lobby's rows only to its own scope, and the league's rows only to the league's",
      actual: { own, other, league },
      expected: {
        own: [3, 3, 0, 0],
        other: { reach: [0, 0, 0, 0], write: '42501' },
        league: [0, 0, 2, 1],
      },
    });
  });
});

test('the subject scope reads a person their own rows across tenants and nothing else', async () => {
  await inRolledBackTransaction(url, async (sql) => {
    const ids = await loadSampleTournament(sql);
    const [debater] = (await sql.unsafe(
      'select user_id from actors where id = $1',
      [ids.debaters[0]],
    )) as Array<{ user_id: string }>;
    const own = () =>
      Promise.all([
        rows(sql, 'select 1 from memberships'),
        rows(sql, 'select 1 from grants'),
        rows(sql, 'select 1 from entry_members'),
        rows(sql, 'select 1 from tournament_judges'),
      ]);
    assert({
      given:
        'a staff member with a membership and a lobby grant, and a debater in one entry',
      should:
        'read each their own rows and no other, and let neither write through it',
      actual: {
        staff: await asRuntime(sql, { subjectUserId: ids.staff }, own),
        debater: await asRuntime(sql, { subjectUserId: debater!.user_id }, own),
        write: await asRuntime(sql, { subjectUserId: ids.staff }, () =>
          changed(
            sql,
            `update memberships set status = 'ended', ended_at = now()`,
          ),
        ),
      },
      expected: { staff: [1, 1, 0, 0], debater: [0, 0, 1, 0], write: 0 },
    });
  });
});

test("an event's settings chain reads across three tenants under one lobby scope", async () => {
  await inRolledBackTransaction(url, async (sql) => {
    const ids = await loadSampleTournament(sql);
    const chain = await asRuntime(sql, { lobbyId: ids.lobby }, async () => ({
      scopes: (
        (await sql.unsafe(
          `select s.scope_kind from settings s
           where s.organization_id = $1 or s.template_id = $2 or s.lobby_id = $3
           order by s.scope_kind`,
          [ids.league, ids.template, ids.lobby],
        )) as Array<{ scope_kind: string }>
      ).map((row) => row.scope_kind),
      // What the chain needs beside settings: the template's pins, its
      // organization, and Daisy's own templates.
      template: await rows(sql, 'select 1 from templates where id = $1', [
        ids.template,
      ]),
      daisyTemplates: await rows(
        sql,
        `select 1 from templates t join organizations o on o.id = t.organization_id where o.handle = 'daisy'`,
      ),
      written: await changed(
        sql,
        `update settings set hold = 'default' where template_id = $1`,
        [ids.template],
      ),
    }));
    assert({
      given:
        "an event that follows a league's template in the league's tournament, read under the lobby's scope alone",
      should:
        "read the organization's, the template's, the lobby's and the event's settings, and change none it does not own",
      actual: chain,
      expected: {
        scopes: ['event', 'lobby', 'organization', 'template'],
        template: 1,
        daisyTemplates: 3,
        written: 0,
      },
    });
  });
});

test('withScope sets its scope for its own transaction only', async () => {
  const client = new SQL(url, { max: 1 });
  try {
    const database = drizzle({ client });
    const scope = { organizationId: createId(), lobbyId: createId() };
    const read = async (executor: {
      execute: (statement: ReturnType<typeof query>) => PromiseLike<unknown>;
    }) =>
      await executor.execute(
        query`select daisy_organization_scope() as organization, daisy_lobby_scope() as lobby, daisy_subject_scope() as subject`,
      );
    const inside = await withScope(database, scope, (transaction) =>
      read(transaction),
    );
    const after = await read(database);
    assert({
      given: 'a transaction opened with an organization and a lobby',
      should:
        'hold exactly that scope inside it and none on the connection after',
      actual: { inside, after },
      expected: {
        inside: [
          {
            organization: scope.organizationId,
            lobby: scope.lobbyId,
            subject: null,
          },
        ],
        after: [{ organization: null, lobby: null, subject: null }],
      },
    });
  } finally {
    await client.close();
  }
});
