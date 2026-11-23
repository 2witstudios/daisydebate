import { sql } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { parsedColumn } from './raw-rows';

/** Past this with no heartbeat, the stage ends its own Egress (ADR 0099). */
const STALE = sql.raw(`interval '10 seconds'`);

/** The control plane has reached this capture, by the database's clock. */
export const controlHeartbeat = () => ({
  controlHeartbeatAt: sql`clock_timestamp()`,
});

/** Whether this capture's heartbeat has lapsed now, by the same clock that wrote it. */
export const heartbeatStale = (table: {
  readonly controlHeartbeatAt: PgColumn;
}) =>
  parsedColumn(
    z.boolean(),
    sql`coalesce(${table.controlHeartbeatAt} < clock_timestamp() - ${STALE}, false)`,
  );
