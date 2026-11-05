import { sql } from 'drizzle-orm';
import type { PrivacyAdopter } from './privacy/contracts';

/** DEC-316: allowance identity belongs to this account, never a future signup. */
export const usagePrivacyAdopter: PrivacyAdopter = {
  id: 'usage',
  phase: 'after-close',
  erase: async (tx, subject) => {
    // Closure already holds the canonical account fence. A stale worker cannot
    // admit or dispatch, and late provider accounting cannot recreate this row.
    await tx.execute(
      sql`delete from usage_reservations where actor_id=${subject.actorId}`,
    );
  },
  export: async (tx, subject) => {
    const rows =
      await tx.execute(sql`select id,round_id,kind,source,state,binds_free_judge,
      to_char(reserved_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as reserved_at,
      to_char(binding_released_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as binding_released_at
      from usage_reservations where actor_id=${subject.actorId} order by reserved_at,id`);
    return { usage_reservations: rows as unknown as Record<string, unknown>[] };
  },
};
