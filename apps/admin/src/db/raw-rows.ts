import type { SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { AdminTx } from './tx';

/**
 * The rows of one raw admin statement, each parsed by `rowSchema`. A row the
 * schema refuses means the statement and its schema disagree; the error
 * names neither the statement nor the values.
 */
export async function query<Row extends z.ZodType>(
  tx: Pick<AdminTx, 'execute'>,
  rowSchema: Row,
  statement: SQL,
): Promise<z.output<Row>[]> {
  const parsed = z.array(rowSchema).safeParse(await tx.execute(statement));
  if (!parsed.success)
    throw new Error('An admin raw read returned a row its schema refuses');
  return parsed.data;
}

/** Runs one raw admin statement whose rows nobody reads. */
export async function run(tx: Pick<AdminTx, 'execute'>, statement: SQL) {
  await tx.execute(statement);
}
