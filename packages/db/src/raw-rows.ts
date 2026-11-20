import type { SQL } from 'drizzle-orm';
import { z } from 'zod';
import { createAppError } from '@daisy/errors';
import type { Tx } from './tx';

/** The rows of one raw statement, as the caller says they are. */
export const rowsOf = async <T>(tx: Pick<Tx, 'execute'>, statement: SQL) =>
  (await tx.execute(statement)) as unknown as T[];

/**
 * The rows of one raw statement, each parsed by `rowSchema`. A row the schema
 * refuses is an invariant failure: the statement and its schema disagree.
 * Bun SQL answers int8 as a string (a bigint inside a bounded writer),
 * numeric as a string and timestamptz as a Date; the schema says which.
 */
export async function query<Row extends z.ZodType>(
  tx: Pick<Tx, 'execute'>,
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
export async function run(tx: Pick<Tx, 'execute'>, statement: SQL) {
  await tx.execute(statement);
}
