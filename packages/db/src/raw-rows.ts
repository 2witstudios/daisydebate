import type { SQL } from 'drizzle-orm';
import { z } from 'zod';
import { tryInstantMs } from '@daisy/clock';
import { createAppError } from '@daisy/errors';

type RawExecutor = {
  readonly execute: (statement: SQL) => PromiseLike<unknown>;
};

/** PostgreSQL int8 representations from Bun SQL and bounded writers. */
export const postgresInt8 = z.union([
  z.string().regex(/^-?\d+$/),
  z.bigint(),
  z.int(),
]);

/**
 * A timestamptz as epoch milliseconds. Bun SQL answers a Date; JSON built in
 * SQL answers ISO text; a `::text` cast answers PostgreSQL's own form
 * (`2026-11-22 10:00:00.5+00`), read here as the same instant. Anything else
 * is refused, never guessed.
 */
export const postgresInstantMs = z
  .union([z.date(), z.string()])
  .transform((value, context) => {
    const milliseconds =
      value instanceof Date
        ? value.getTime()
        : tryInstantMs(
            value
              .replace(/^(\d{4}-\d{2}-\d{2}) /, '$1T')
              .replace(/([+-]\d{2})$/, '$1:00'),
          );
    if (milliseconds === undefined || !Number.isFinite(milliseconds)) {
      context.addIssue({ code: 'custom', message: 'Expected an instant' });
      return z.NEVER;
    }
    return milliseconds;
  });

/**
 * The rows of one raw statement, each parsed by `rowSchema`. A row the schema
 * refuses is an invariant failure: the statement and its schema disagree.
 * Bun SQL answers int8 as a string (a bigint inside a bounded writer),
 * numeric as a string and timestamptz as a Date; the schema says which.
 * A Bun tagged statement carries its own connection, including a reservation.
 */
export async function query<Row extends z.ZodType>(
  ...read:
    | [tx: RawExecutor, rowSchema: Row, statement: SQL]
    | [statement: PromiseLike<unknown>, rowSchema: Row]
): Promise<z.output<Row>[]> {
  const rows = await (read.length === 2 ? read[0] : read[0].execute(read[2]));
  const parsed = z.array(read[1]).safeParse(rows);
  if (!parsed.success)
    throw createAppError(
      'INVARIANT',
      'A raw read returned a row its schema refuses',
      // Nested paths may include user-supplied object keys.
      parsed.error.issues.map(({ path: [index], code }) => ({
        row: typeof index === 'number' ? index : undefined,
        code,
      })),
    );
  return parsed.data;
}

/** Runs one raw statement whose rows nobody reads. */
export async function run(tx: RawExecutor, statement: SQL) {
  await tx.execute(statement);
}

/**
 * A selected SQL fragment whose value is parsed by `schema`, the typed form
 * of a column Drizzle cannot type itself. Drizzle passes a null past the
 * decoder, so a nullable fragment's schema says `.nullable()` for its type.
 * A value the schema refuses is an invariant failure, as in `query`.
 */
export function parsedColumn<Schema extends z.ZodType>(
  schema: Schema,
  fragment: SQL,
): SQL<z.output<Schema>> {
  return fragment.mapWith((value: unknown): z.output<Schema> => {
    const parsed = schema.safeParse(value);
    if (!parsed.success)
      throw createAppError(
        'INVARIANT',
        'A selected column returned a value its schema refuses',
        parsed.error.issues.map(({ code }) => ({ code })),
      );
    return parsed.data;
  });
}
/** Export values in plain JSON: ISO dates and numeric counters. */
export const exportRows = (rows: readonly Record<string, unknown>[]) =>
  rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([column, value]) => [
        column,
        value instanceof Date
          ? value.toISOString()
          : typeof value === 'bigint'
            ? Number(value)
            : value,
      ]),
    ),
  );
