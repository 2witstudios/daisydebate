import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';

/** Durable retry discovery for committed RT forfeits, never ranked admission. */
export async function readUnratedAttendanceForfeits(
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
    where r.status='completed' and r.competition_type='ranked'
      and r.ladder_id is not null and r.completed_at is not null
      and r.outcome in ('affirmative','negative')
      and (${input.afterId ?? null}::text is null or r.id > ${input.afterId ?? null})
      and exists(select 1 from round_attendance_adjudications a where a.round_id=r.id and a.decision='forfeit')
      and not exists(select 1 from round_check_in_attempts p where p.round_id=r.id and p.state='pending')
      and not exists(select 1 from rating_changes c where c.round_id=r.id)
    order by r.id limit ${input.limit}`);
  return (rows as unknown as { id: string }[]).map(({ id }) => id);
}
