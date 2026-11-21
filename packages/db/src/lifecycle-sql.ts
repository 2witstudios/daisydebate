import { sql } from 'drizzle-orm';
import type { roomStatuses, RoundStatus } from '@daisy/protocol';

type LifecycleStatus = (typeof roomStatuses)[number] | RoundStatus;

/** Render a fixed vocabulary member so PostgreSQL can use partial indexes. */
export const lifecycleSql = (status: LifecycleStatus) =>
  sql`${status}`.inlineParams();

export const lifecycleSqlList = (statuses: readonly LifecycleStatus[]) =>
  sql`(${sql.join(statuses.map(lifecycleSql), sql`, `)})`;
