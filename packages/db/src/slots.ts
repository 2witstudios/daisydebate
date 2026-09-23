/**
 * Local slot administration (ADR 0034): one shared cluster, one database per
 * checkout slot, copied from a template that carries the e2e role grants.
 * Development tooling only; nothing on the request path imports it.
 *
 * Identifiers and literals in CREATE/DROP/COMMENT/ROLE statements cannot be
 * bound as parameters, so every one is checked against a strict allowlist
 * before it is quoted into SQL.
 */
import type { SQL } from 'bun';

const identifierPattern = /^[a-z_][a-z0-9_]{0,62}$/;
const passwordPattern = /^[a-z0-9-]{1,64}$/;
const commentPattern = /^[a-z0-9 =-]{1,100}$/;

function quoteIdentifier(name: string): string {
  if (!identifierPattern.test(name))
    throw new Error('Invalid database identifier');
  return `"${name}"`;
}

function quoteLiteral(value: string, pattern: RegExp, label: string): string {
  if (!pattern.test(value)) throw new Error(`Invalid ${label}`);
  return `'${value}'`;
}

export type SlotRole = { readonly user: string; readonly password: string };

/** The loopback-only login the production-mode browser suite uses. */
export async function ensureE2ERole(admin: SQL, role: SlotRole): Promise<void> {
  const user = quoteIdentifier(role.user);
  const password = quoteLiteral(role.password, passwordPattern, 'password');
  const [existing] =
    await admin`select 1 from pg_roles where rolname = ${role.user}`;
  if (existing) return;
  try {
    await admin.unsafe(`create role ${user} login password ${password}`);
  } catch (error) {
    // A concurrent slot:up created it first.
    if ((error as { errno?: string }).errno !== '42710') throw error;
  }
}

/**
 * Grants the e2e role what the browser suite needs on objects the current
 * (migration) role creates: schema usage, table DML and sequence use, both
 * for existing objects and by default privileges for future ones.
 */
export async function grantE2EAccess(
  database: SQL,
  e2eUser: string,
): Promise<void> {
  const user = quoteIdentifier(e2eUser);
  await database.unsafe(`
    grant usage on schema public to ${user};
    grant select, insert, update, delete on all tables in schema public to ${user};
    grant usage, select on all sequences in schema public to ${user};
    alter default privileges in schema public
      grant select, insert, update, delete on tables to ${user};
    alter default privileges in schema public
      grant usage, select on sequences to ${user};
  `);
}

/** Drops every table (reset), then restores the e2e grants on the new schema. */
export async function resetPublicSchema(
  database: SQL,
  e2eUser: string,
): Promise<void> {
  await database.unsafe(`
    drop schema if exists public cascade;
    drop schema if exists drizzle cascade;
    create schema public;
  `);
  await grantE2EAccess(database, e2eUser);
}

/**
 * Creates the template if missing: grants applied, then marked as a template
 * that accepts no connections, so copying from it never fails with "source
 * database is being accessed by other users".
 */
export async function ensureTemplate({
  admin,
  connect,
  template,
  e2eUser,
}: {
  readonly admin: SQL;
  readonly connect: (database: string) => SQL;
  readonly template: string;
  readonly e2eUser: string;
}): Promise<void> {
  const name = quoteIdentifier(template);
  const [existing] = await admin`
    select datistemplate from pg_database where datname = ${template}
  `;
  if (existing?.datistemplate) return;
  if (!existing) await createSlotDatabase(admin, template, 'template1');
  const database = connect(template);
  try {
    await grantE2EAccess(database, e2eUser);
  } finally {
    await database.close();
  }
  await admin.unsafe(
    `alter database ${name} with is_template true allow_connections false`,
  );
}

/** Returns false when the database already exists (idempotent). */
export async function createSlotDatabase(
  admin: SQL,
  database: string,
  template: string,
): Promise<boolean> {
  const name = quoteIdentifier(database);
  const source = quoteIdentifier(template);
  const [existing] =
    await admin`select 1 from pg_database where datname = ${database}`;
  if (existing) return false;
  try {
    await admin.unsafe(`create database ${name} template ${source}`);
    return true;
  } catch (error) {
    if ((error as { errno?: string }).errno === '42P04') return false;
    throw error;
  }
}

export type SlotDatabase = {
  readonly name: string;
  readonly comment: string | null;
};

export async function listSlotDatabases(
  admin: SQL,
  prefix: string,
): Promise<readonly SlotDatabase[]> {
  const rows = await admin`
    select datname as name, shobj_description(oid, 'pg_database') as comment
    from pg_database
    where starts_with(datname, ${prefix})
    order by datname
  `;
  return rows as SlotDatabase[];
}

export async function setSlotDatabaseComment(
  admin: SQL,
  database: string,
  comment: string,
): Promise<void> {
  const name = quoteIdentifier(database);
  const literal = quoteLiteral(comment, commentPattern, 'comment');
  await admin.unsafe(`comment on database ${name} is ${literal}`);
}

/** Drops even while a forgotten dev server still holds connections. */
export async function dropSlotDatabase(
  admin: SQL,
  database: string,
): Promise<void> {
  const name = quoteIdentifier(database);
  await admin.unsafe(`drop database if exists ${name} with (force)`);
}

/**
 * Serializes slot administration across checkouts (prune, create, port
 * claims) with a cluster-wide session advisory lock. `admin` must be a
 * single-connection client (`max: 1`) so the lock and the work share one
 * session; a dropped connection releases the lock.
 */
export async function withSlotLock<T>(
  admin: SQL,
  work: () => Promise<T>,
): Promise<T> {
  await admin`select pg_advisory_lock(hashtext('daisy-slot-admin'))`;
  try {
    return await work();
  } finally {
    await admin`select pg_advisory_unlock(hashtext('daisy-slot-admin'))`;
  }
}
