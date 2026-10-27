import { SQL } from 'bun';
import { readdir } from 'node:fs/promises';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { runMigrations } from '../src/migrator';
import {
  ddlTimeoutMs,
  scratchDatabase,
} from './scratch-migrations.test-support';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

const migrationsFolder = new URL('../migrations', import.meta.url).pathname;

/**
 * Every object in the migrated schemas that the given role does not own.
 * A trusted extension's member objects are owned by the bootstrap superuser
 * that runs its script, so members are left out; the extension itself is not.
 * Schema `public` belongs to `pg_database_owner`, which is the database's owner.
 */
const foreignObjects = (sql: SQL, role: string) => sql`
  with members as (
    select objid from pg_depend where deptype = 'e'
  )
  select 'relation ' || n.nspname || '.' || c.relname as object
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'drizzle') and pg_get_userbyid(c.relowner) <> ${role}
      and c.oid not in (select objid from members)
  union all
  select 'function ' || p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'drizzle') and pg_get_userbyid(p.proowner) <> ${role}
      and p.oid not in (select objid from members)
  union all
  select 'type ' || t.typname from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where n.nspname in ('public', 'drizzle') and pg_get_userbyid(t.typowner) <> ${role}
      and t.oid not in (select objid from members)
  union all
  select 'schema ' || nspname from pg_namespace
    where nspname in ('public', 'drizzle')
      and pg_get_userbyid(nspowner) not in (${role}, 'pg_database_owner')
  union all
  select 'database ' || datname from pg_database
    where datname = current_database() and pg_get_userbyid(datdba) <> ${role}
  union all
  select 'extension ' || extname from pg_extension
    where extname = 'btree_gist' and pg_get_userbyid(extowner) <> ${role}`;

test(
  'a NOSUPERUSER NOCREATEDB NOCREATEROLE owner migrates an empty database and owns everything (ADR 0080)',
  async () => {
    // The runtime roles already exist, as the operator provisions them
    // (ADR 0080 §2); this suite's own database was migrated by a superuser.
    const role = `daisy_migrator_${createId()}`;
    const password = Buffer.from(
      crypto.getRandomValues(new Uint8Array(24)),
    ).toString('hex');
    const superuser = new SQL(url, { max: 1 });
    const scratch = scratchDatabase(url, 'least_owner');
    const owned = new URL(scratch.url);
    owned.username = role;
    owned.password = password;
    await superuser.unsafe(
      `create role ${role} login password '${password}' nosuperuser nocreatedb nocreaterole noreplication nobypassrls`,
    );
    try {
      await scratch.create();
      const scratchName = new URL(scratch.url).pathname.slice(1);
      await superuser.unsafe(
        `alter database "${scratchName}" owner to ${role}`,
      );
      await runMigrations({ databaseUrl: owned.toString(), migrationsFolder });
      const migrations = (await readdir(migrationsFolder)).filter((entry) =>
        /^\d{14}_/.test(entry),
      ).length;
      const reader = new SQL(owned.toString(), { max: 1 });
      try {
        const [journal] =
          await reader`select count(*)::int as n from drizzle.__drizzle_migrations`;
        const [privileges] =
          await reader`select rolsuper, rolcreatedb, rolcreaterole from pg_roles where rolname = current_user`;
        assert({
          given:
            'every committed migration run from empty by a least-privilege login that owns the database',
          should:
            'apply them all, leave that login without cluster privileges, and make it the owner of every migrated object',
          actual: {
            journal: journal?.n,
            privileges,
            foreign: [...(await foreignObjects(reader, role))],
          },
          expected: {
            journal: migrations,
            privileges: {
              rolsuper: false,
              rolcreatedb: false,
              rolcreaterole: false,
            },
            foreign: [],
          },
        });
      } finally {
        await reader.close();
      }
    } finally {
      await scratch.drop();
      await superuser.unsafe(`drop role if exists ${role}`);
      await superuser.close();
    }
  },
  ddlTimeoutMs,
);
