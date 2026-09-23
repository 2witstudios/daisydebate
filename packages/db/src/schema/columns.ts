import { sql, type SQL } from 'drizzle-orm';
import {
  check,
  customType,
  integer,
  timestamp,
  type PgColumn,
  type PgTimestampBuilderInitial,
} from 'drizzle-orm/pg-core';

/**
 * Column recipes shared by the competitive tables (ADR 0029). Builders are
 * single-use, so each call returns a fresh one. Timestamps are timestamptz
 * mapped to Date (see the mode warning in `../index.ts`); the application
 * converts to UTC ISO strings at its edge.
 */
export const timestampColumn = (
  name: string,
): PgTimestampBuilderInitial<string> =>
  timestamp(name, { withTimezone: true, mode: 'date' });

export const createdAtColumn = () =>
  timestampColumn('created_at').notNull().defaultNow();

export const updatedAtColumn = () =>
  timestampColumn('updated_at').notNull().defaultNow();

/** Optimistic-concurrency counter; `versionPositive` adds its CHECK. */
export const versionColumn = () => integer('version').notNull().default(1);

export const versionPositive = (table: string, column: PgColumn) =>
  check(`${table}_version_positive`, sql`${column} > 0`);

/**
 * `column IN ('a', 'b')` over a closed vocabulary. Values are constant
 * identifiers from `@daisy/protocol` or a schema file, never user input, so
 * they are inlined as literals for drizzle-kit to serialize.
 */
export const oneOf = (column: PgColumn, values: readonly string[]): SQL =>
  sql`${column} in (${sql.raw(values.map((value) => `'${value}'`).join(', '))})`;

/**
 * drizzle-orm 0.45.2's built-in `jsonb()` always `JSON.stringify`s its
 * value in `mapToDriverValue`, and the Bun SQL driver then encodes that
 * string a second time, so every write lands as a JSON string
 * (`jsonb_typeof = 'string'`) instead of an object. This `customType` has
 * no `toDriver`/`fromDriver`, so the value passes straight through to and
 * from Bun's driver, which serializes a plain object as real `jsonb`. Use
 * it for every jsonb column instead of drizzle-orm's `jsonb()`.
 */
export const jsonbColumn = customType<{ data: unknown; driverData: unknown }>({
  dataType: () => 'jsonb',
});
