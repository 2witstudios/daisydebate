import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import { finalizedRatingInput } from './rating-finalization';
import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';

/** Durable, bounded retry discovery for every finalized rated result. */
export async function readUnratedRatingRounds(
  db: Pick<BunSQLDatabase, 'execute'>,
  input: { readonly afterId?: string; readonly limit: number },
): Promise<readonly string[]> {
  if (
    (input.afterId !== undefined &&
      !idSchema.safeParse(input.afterId).success) ||
    !Number.isSafeInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > 1000
  )
    throw createAppError('VALIDATION');
  const rows = await db.execute(sql`select r.id from rounds r
    where ${finalizedRatingInput}
      and (${input.afterId ?? null}::text is null or r.id > ${input.afterId ?? null})
      and not exists(select 1 from rating_changes c where c.round_id=r.id)
    order by r.id limit ${input.limit}`);
  return (rows as unknown as { id: string }[]).map(({ id }) => id);
}
