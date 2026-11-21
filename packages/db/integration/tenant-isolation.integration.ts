import { afterAll } from 'bun:test';
import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { assert, test } from 'riteway/bun';
import { createDatabase } from '../src/index';
import {
  tenantIsolationFactsSql,
  tenantIsolationProblems,
  type TenantTableFacts,
} from '../src/tenant-isolation';
import {
  tenantDefinerFactsSql,
  tenantDefinerProblems,
  type TenantDefinerFacts,
} from '../src/tenant-definers';
import { tenantIsolationManifest } from '../src/tenant-isolation-manifest';
import {
  ddlTimeoutMs,
  scratchDatabase,
} from './scratch-migrations.test-support';
import { integrationSuite } from './suite.test-support';
import { inRolledBackTransaction } from './tab.test-support';

const { databaseUrl: url } = integrationSuite();

const schema = '20261117122348_tab_schema';
const scratch = scratchDatabase(url, 'tenantisolation');
afterAll(() => scratch.drop());

const problemsOf = async (
  databaseUrl: string,
  manifest = tenantIsolationManifest,
) => {
  const sql = new SQL(databaseUrl, { max: 1 });
  try {
    return tenantIsolationProblems(
      (await sql.unsafe(
        tenantIsolationFactsSql,
      )) as readonly TenantTableFacts[],
      manifest,
    );
  } finally {
    await sql.close();
  }
};

/**
 * TAB-4.1 and half of the schema slice's proof of done: the isolation check
 * passes on the migrated schema, read as production start-up and
 * `bun doctor` read it.
 */
test('the migrated schema is fenced exactly as the manifest declares', async () => {
  const database = createDatabase({ url, nextActorId: createId });
  try {
    assert({
      given: 'every committed migration applied to an empty database',
      should: 'report no tenant isolation problem',
      actual: await database.tenantIsolationProblems(),
      expected: [],
    });
  } finally {
    await database.close();
  }
});

test(
  'the isolation check passes after each migration step, and not before the schema exists',
  async () => {
    await scratch.create();
    await scratch.migrate((folder) => folder < schema);
    const before = await problemsOf(scratch.url);
    await scratch.migrate((folder) => folder <= schema);
    // The original schema predates protected-person history and league extensions. Verify its own
    // two-scope contract, then the current contract after the forward migration.
    const originalTables = tenantIsolationManifest.tables
      .filter(
        (table) =>
          ![
            'tournament_sponsorship_versions',
            'tournament_capture_admissions',
            'tournament_hosting_purchases',
            'fixture_room_sources',
            'league_schools',
            'membership_periods',
            'tournament_rating_snapshots',
            // Club seats arrive later (ADR 0148).
            'club_seats',
            'club_seat_invitations',
            // Media releases arrive later (ADR 0151).
            'media_release_club_attestations',
            'guardian_consent_evidence',
            'child_account_requests',
            // Rating state gains a lobby key and isolation in LL-2.
            'ratings',
            'rating_changes',
          ].includes(table.table),
      )
      .map((table) =>
        table.table === 'action_history'
          ? { ...table, key: 'either' as const }
          : table.table === 'guardian_links'
            ? {
                table: 'guardian_links',
                key: 'person' as const,
                subject: 'guardian' as const,
              }
            : table,
      );
    const afterSchema = await problemsOf(scratch.url, {
      ...tenantIsolationManifest,
      tables: [
        ...originalTables,
        { table: 'restrictions', key: 'person', subject: 'guardian' },
      ],
      exempt: [
        ...tenantIsolationManifest.exempt.filter(
          (entry) => entry.table !== 'media_release_club_asks',
        ),
        {
          table: 'ratings',
          reason: 'The pre-LL-2 projection was public across ladders.',
        },
        {
          table: 'rating_changes',
          reason: 'The pre-LL-2 ledger had no tenant key.',
        },
      ],
    });
    await scratch.migrate(() => true);
    const afterAllFolders = await problemsOf(scratch.url);
    assert({
      given:
        'a database migrated to the folder before the tab schema, then to it, then to the end',
      should:
        'report every declared table missing before, and nothing after each step',
      actual: {
        before: before.length,
        firstBefore: before[0],
        afterSchema,
        afterAllFolders,
      },
      expected: {
        before:
          tenantIsolationManifest.tables.length +
          // The media release club asks arrive later. Ratings and the ledger
          // already exist here, with one additional unfenced-key diagnostic each.
          3,
        firstBefore: 'organizations is declared but does not exist',
        afterSchema: [],
        afterAllFolders: [],
      },
    });
  },
  ddlTimeoutMs,
);

/** The check's report after one fault, made in a transaction that is rolled back. */
const afterFault = (fault: string) =>
  new Promise<readonly string[]>((resolve, reject) => {
    inRolledBackTransaction(url, async (sql) => {
      await sql.unsafe(fault);
      resolve(
        tenantIsolationProblems(
          (await sql.unsafe(
            tenantIsolationFactsSql,
          )) as readonly TenantTableFacts[],
          tenantIsolationManifest,
        ),
      );
    }).catch(reject);
  });

/** TAB-4.2 and TAB-4.22: each fault, made on purpose, is reported. */
test('a tenant-owned table with no policy or a wrong one is reported', async () => {
  assert({
    given:
      'row-level security switched off on one table, a policy dropped from another and a policy expression widened on a third',
    should: 'report each fault and nothing else',
    actual: [
      await afterFault('alter table events disable row level security'),
      await afterFault('drop policy grants_subject on grants'),
      await afterFault('alter policy fixtures_scope on fixtures using (true)'),
    ],
    expected: [
      ['events does not have row-level security enabled'],
      [
        'grants lacks the policy grants_subject for select using (user_id = daisy_subject_scope()) with check nothing',
      ],
      [
        'fixtures lacks the policy fixtures_scope for all using (lobby_id = daisy_lobby_scope()) with check (lobby_id = daisy_lobby_scope())',
        'fixtures has an undeclared policy: fixtures_scope for all using true with check (lobby_id = daisy_lobby_scope())',
      ],
    ],
  });
});

test('a table that carries or references a tenant key undeclared is reported', async () => {
  assert({
    given:
      'a new child table missing its key, a new table with a lobby_id column, and a new table with a tournament_id column',
    should: 'report each',
    actual: [
      await afterFault(
        'create table venues (id text primary key, event_id text references events (id))',
      ),
      await afterFault(
        'create table check_ins (id text primary key, lobby_id text not null)',
      ),
      await afterFault(
        'create table awards (id text primary key, tournament_id text)',
      ),
    ],
    expected: [
      ['venues references events but is neither tenant-owned nor exempt'],
      ['check_ins carries lobby_id but is neither tenant-owned nor exempt'],
      ['awards has a tournament_id column: a tournament is a lobby'],
    ],
  });
});

test('a nullable isolation key without its declared scope CHECK is reported', async () => {
  assert({
    given:
      'a lobby key made nullable, and a two-scope and three-scope table with their CHECKs dropped',
    should: 'report each',
    actual: [
      await afterFault(
        'alter table releases alter column lobby_id drop not null',
      ),
      await afterFault(
        'alter table grants drop constraint grants_one_tenant_key',
      ),
      await afterFault(
        'alter table action_history drop constraint action_history_one_scope',
      ),
    ],
    expected: [
      ['releases.lobby_id is nullable'],
      [
        'grants carries a nullable isolation key without the grants_one_tenant_key CHECK',
      ],
      ['action_history lacks its one-scope CHECK'],
    ],
  });
});

test('a privilege for the realtime role or PUBLIC on a tenant-owned table is reported', async () => {
  assert({
    given: 'SELECT on results granted to daisy_realtime, and to PUBLIC',
    should: 'report each grantee',
    actual: [
      await afterFault('grant select on results to daisy_realtime'),
      await afterFault('grant select (id) on results to public'),
    ],
    expected: [
      ['daisy_realtime holds a privilege on results'],
      ['PUBLIC holds a privilege on results'],
    ],
  });
});

/** The definer check's report after one fault, rolled back. */
const afterDefinerFault = (fault: string) =>
  new Promise<readonly string[]>((resolve, reject) => {
    inRolledBackTransaction(url, async (sql) => {
      await sql.unsafe(fault);
      resolve(
        tenantDefinerProblems(
          (await sql.unsafe(
            tenantDefinerFactsSql,
          )) as readonly TenantDefinerFacts[],
          tenantIsolationManifest,
        ),
      );
    }).catch(reject);
  });

/** ADR 0158: a read across tenants goes only through a registered definer. */
test('an unregistered or widened SECURITY DEFINER function over tenant tables is reported', async () => {
  assert({
    given:
      'a new definer reading grants, the linked-adult Round read opened to PUBLIC, its realtime grant revoked, its search path dropped, a BEGIN ATOMIC definer naming MEMBERSHIPS, Room chat’s fact without pg_temp last, a wrapper of the minor read, and a definer in another schema',
    should: 'report each fault and nothing else',
    actual: [
      await afterDefinerFault(
        `create function public.daisy_widened() returns setof text language sql stable security definer
          set search_path = pg_catalog, public, pg_temp as $$ select user_id from public.grants $$`,
      ),
      await afterDefinerFault(
        'grant execute on function public.daisy_round_linked_adult_actors(text) to public',
      ),
      await afterDefinerFault(
        'revoke execute on function public.daisy_round_linked_adult_actors(text) from daisy_realtime',
      ),
      await afterDefinerFault(
        'alter function public.daisy_linked_adult_users(text) reset search_path',
      ),
      await afterDefinerFault(
        `create function public.daisy_atomic() returns setof text language sql stable security definer
          set search_path = pg_catalog, public, pg_temp begin atomic select user_id from public.MEMBERSHIPS; end`,
      ),
      await afterDefinerFault(
        'alter function public.daisy_room_community_fact(text,text) set search_path = pg_catalog, public',
      ),
      await afterDefinerFault(
        `create function public.daisy_wrapper(u text) returns setof text language sql stable security definer
          set search_path = pg_catalog, public, pg_temp as $$ select user_id from public.daisy_linked_adult_users(u) $$`,
      ),
      await afterDefinerFault(
        `create schema private_fault; create function private_fault.daisy_people() returns setof text language sql stable security definer
          set search_path = pg_catalog, public, pg_temp as $$ select guardian_user_id from public.guardian_links $$`,
      ),
    ],
    expected: [
      [
        'daisy_widened is a SECURITY DEFINER function reading grants but is not registered',
      ],
      ['PUBLIC may execute daisy_round_linked_adult_actors'],
      [
        'daisy_round_linked_adult_actors is executable by daisy_web but registered for daisy_realtime, daisy_web',
      ],
      [
        'daisy_linked_adult_users does not pin its search_path to pg_catalog first and pg_temp last',
      ],
      [
        'daisy_atomic is a SECURITY DEFINER function reading memberships but is not registered',
      ],
      [
        'daisy_room_community_fact does not pin its search_path to pg_catalog first and pg_temp last',
      ],
      [
        'daisy_wrapper is a SECURITY DEFINER function reading daisy_linked_adult_users but is not registered',
      ],
      [
        'private_fault.daisy_people is a SECURITY DEFINER function reading guardian_links but is not registered',
      ],
    ],
  });
});
