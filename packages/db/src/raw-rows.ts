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
 */
export async function query<Row extends z.ZodType>(
  tx: RawExecutor,
  rowSchema: Row,
  statement: SQL,
): Promise<z.output<Row>[]> {
  const parsed = z.array(rowSchema).safeParse(await tx.execute(statement));
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
