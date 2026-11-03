import { sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';

/** Past this with no heartbeat, the control plane counts as gone (ADR 0099). */
const STALE = sql.raw(`interval '10 seconds'`);

type WithHeartbeat = {
  readonly controlHeartbeatAt: PgColumn;
  readonly controlLapses: PgColumn;
};

const epochMs = (at: SQL) => sql`(extract(epoch from ${at}) * 1000)::bigint`;

/**
 * The control plane has reached this capture. Written as one update with the lapse
 * it ends, by the database's clock, so a lapse is recorded by whichever web instance
 * comes back: no watcher has to be alive for it, and no restart can forget one.
 */
export const controlHeartbeat = (table: WithHeartbeat) => ({
  controlHeartbeatAt: sql`clock_timestamp()`,
  controlLapses: sql`case
    when ${table.controlHeartbeatAt} < clock_timestamp() - ${STALE}
    then jsonb_build_object('lapses',
      (${table.controlLapses} -> 'lapses') || jsonb_build_array(jsonb_build_object(
        'fromMs', ${epochMs(sql`${table.controlHeartbeatAt}`)},
        'toMs', ${epochMs(sql`clock_timestamp()`)})))
    else ${table.controlLapses}
  end`,
});

/** Whether this capture's heartbeat has lapsed now, by the same clock that wrote it. */
export const heartbeatStale = (table: WithHeartbeat) =>
  sql<boolean>`coalesce(${table.controlHeartbeatAt} < clock_timestamp() - ${STALE}, false)`;
