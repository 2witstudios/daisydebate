import { sql } from 'drizzle-orm';
import { check, text, type PgColumn } from 'drizzle-orm/pg-core';

/**
 * Recipes for the two isolation keys, `organization_id` and `lobby_id`.
 * A tenant-owned row carries its key on every row and a composite foreign key
 * proves it equal to its parent's, so row-level security can fence on the
 * column alone.
 */

/**
 * A row owned by an organization or by a lobby carries exactly one of the two
 * keys. The isolation check reads this CHECK by its name and definition.
 */
export const oneTenantKey = (
  table: string,
  organizationId: PgColumn,
  lobbyId: PgColumn,
) =>
  check(
    `${table}_one_tenant_key`,
    sql`num_nonnulls(${organizationId}, ${lobbyId}) = 1`,
  );

/**
 * A column that always holds one word, so a composite foreign key onto a
 * parent's `(id, kind)` proves the parent's kind. No writer sets it.
 */
export const constantText = (name: string, value: string) =>
  text(name)
    .notNull()
    .generatedAlwaysAs(sql.raw(`'${value}'`));

export const nonEmpty = (name: string, column: PgColumn) =>
  check(name, sql`length(trim(${column})) > 0`);

/** Two columns that pin one thing together are both set or both null. */
export const bothOrNeither = (name: string, a: PgColumn, b: PgColumn) =>
  check(name, sql`(${a} is null) = (${b} is null)`);

/** A SHA3-256 digest in lowercase hex. */
export const digestCheck = (name: string, column: PgColumn) =>
  check(name, sql`${column} ~ '^[0-9a-f]{64}$'`);
