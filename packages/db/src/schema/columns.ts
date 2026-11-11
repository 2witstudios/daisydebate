import { sql, type SQL } from 'drizzle-orm';
import {
  check,
  customType,
  integer,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { createAppError } from '@daisy/errors';
import { z } from 'zod';

/**
 * Column recipes every table uses (ADR 0029, ADR 0038). Builders are
 * single-use, so each call returns a fresh one.
 */

/**
 * The one timestamp column: timestamptz mapped to Date. Drizzle's string
 * mode relabels the driver's Date with the host's local offset instead of
 * converting it, so it is never used; the application converts to UTC ISO
 * strings at its edge.
 */
export const timestampColumn = (name: string) =>
  timestamp(name, { withTimezone: true, mode: 'date' });

/** PostgreSQL 64-bit transaction ordering token, retained as a decimal string. */
export const xid8Column = customType<{ data: string; driverData: string }>({
  dataType: () => 'xid8',
});

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

/** `later` is unset or not before `earlier`: a time-ordering CHECK body. */
export const notBefore = (later: PgColumn, earlier: PgColumn): SQL =>
  sql`${later} is null or ${later} >= ${earlier}`;

/**
 * The shape of a jsonb column that has no protocol contract yet because
 * nothing writes it (ISSUE-24): any JSON object. Its first writer replaces
 * it with the protocol schema it writes.
 */
export const jsonObjectSchema = z.record(z.string(), z.json());

/**
 * The only jsonb column (ISSUE-24). It cannot be declared without the
 * schema of the value it stores: every write is parsed first, and a value
 * that does not match fails with a typed `VALIDATION` AppError before it
 * reaches the driver, never as an opaque Postgres type error or a silently
 * stored scalar. The parsed object goes to Bun SQL unencoded, which
 * serializes it as real jsonb. Pair it with `jsonbIsObject`, the database
 * half of the same rule.
 */
export const jsonbColumn = <T extends Record<string, unknown>>(
  name: string,
  schema: z.ZodType<T>,
) =>
  customType<{ data: T; driverData: T }>({
    dataType: () => 'jsonb',
    toDriver: (value) => {
      const parsed = schema.safeParse(value);
      if (!parsed.success)
        throw createAppError(
          'VALIDATION',
          `Invalid value for jsonb column ${name}`,
          parsed.error,
        );
      return parsed.data;
    },
  })(name);

/**
 * The nullable form: null passes through unvalidated (there is nothing to
 * validate), anything present is parsed exactly as `jsonbColumn` parses it.
 */
export const jsonbColumnNullable = <T extends Record<string, unknown>>(
  name: string,
  schema: z.ZodType<T>,
) =>
  customType<{ data: T | null; driverData: T | null }>({
    dataType: () => 'jsonb',
    toDriver: (value) => {
      if (value === null) return null;
      const parsed = schema.safeParse(value);
      if (!parsed.success)
        throw createAppError(
          'VALIDATION',
          `Invalid value for jsonb column ${name}`,
          parsed.error,
        );
      return parsed.data;
    },
  })(name);

/** `<table>_<column>_is_object`: the database refuses a jsonb scalar or array. */
export const jsonbIsObject = (table: string, column: PgColumn) =>
  check(
    `${table}_${column.name}_is_object`,
    sql`jsonb_typeof(${column}) = 'object'`,
  );

/**
 * A retried delivery job's lifecycle (vendor deletion, observation purge):
 * pending until one confirmed success, with its attempts and next retry.
 */
export const retriedJobColumns = () => ({
  status: text('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  createdAt: timestampColumn('created_at').notNull(),
  retryAt: timestampColumn('retry_at').notNull(),
  succeededAt: timestampColumn('succeeded_at'),
});
export const retriedJobChecks = (
  table: string,
  columns: {
    readonly status: PgColumn;
    readonly attempts: PgColumn;
    readonly succeededAt: PgColumn;
  },
) => [
  check(
    `${table}_status_valid`,
    oneOf(columns.status, ['pending', 'succeeded']),
  ),
  check(`${table}_attempts_nonnegative`, sql`${columns.attempts} >= 0`),
  check(
    `${table}_success_consistent`,
    sql`(${columns.status} = 'succeeded') = (${columns.succeededAt} is not null)`,
  ),
];

/** A queued mail job's five states: owed, held by a worker, or ended one of three ways. */
const mailJobStates = [
  'queued',
  'leased',
  'sent',
  'failed',
  'cancelled',
] as const;

/**
 * A queued mail job's lifecycle (ADR 0075, ADR 0124): owed from the moment it
 * is written, sent later by a worker under a lease, retried with backoff, and
 * ended sent, failed or cancelled. `mailQueue` is its one writer.
 */
export const mailJobColumns = () => ({
  state: text('state').notNull().default('queued'),
  attempts: integer('attempts').notNull().default(0),
  leaseTokenDigest: text('lease_token_digest'),
  leaseExpiresAt: timestampColumn('lease_expires_at'),
  nextAttemptAt: timestampColumn('next_attempt_at').notNull(),
  lastErrorCode: text('last_error_code'),
  createdAt: createdAtColumn(),
  completedAt: timestampColumn('completed_at'),
});
/** The codes `mailQueue` writes itself: a table's own list must hold them. */
export type MailQueueErrorCode = 'delivery' | 'delivery-unknown' | 'not-owed';

export const mailJobChecks = <const Codes extends readonly string[]>(
  table: string,
  columns: {
    readonly state: PgColumn;
    readonly attempts: PgColumn;
    readonly leaseTokenDigest: PgColumn;
    readonly leaseExpiresAt: PgColumn;
    readonly lastErrorCode: PgColumn;
    readonly completedAt: PgColumn;
  },
  // A list without the queue's own codes does not typecheck: its writer could
  // not write to that table.
  errorCodes: MailQueueErrorCode extends Codes[number] ? Codes : never,
) => [
  check(`${table}_state_check`, oneOf(columns.state, mailJobStates)),
  check(`${table}_attempts_check`, sql`${columns.attempts} >= 0`),
  check(
    `${table}_lease_check`,
    sql`(${columns.state} = 'leased') = (${columns.leaseTokenDigest} is not null and ${columns.leaseExpiresAt} is not null) and (${columns.leaseTokenDigest} is null or ${columns.leaseTokenDigest} ~ '^[0-9a-f]{64}$')`,
  ),
  check(
    `${table}_completed_check`,
    sql`(${columns.state} in ('sent', 'failed', 'cancelled')) = (${columns.completedAt} is not null)`,
  ),
  check(
    `${table}_error_check`,
    sql`${columns.lastErrorCode} is null or ${oneOf(columns.lastErrorCode, errorCodes)}`,
  ),
];
