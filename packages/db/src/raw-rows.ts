import type { SQL } from 'drizzle-orm';
import { z } from 'zod';
import { createAppError } from '@daisy/errors';
import type { Tx } from './tx';

type RawExecutor = {
  readonly execute: (statement: SQL) => PromiseLike<unknown>;
};

/** Binds Drizzle's raw method when building the adapter's opaque Tx surface. */
export const boundExecute = (tx: Tx): Tx['execute'] => tx.execute.bind(tx);

/** PostgreSQL int8 representations from Bun SQL and bounded writers. */
export const postgresInt8 = z.union([
  z.string().regex(/^-?\d+$/),
  z.bigint(),
  z.int(),
]);

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
