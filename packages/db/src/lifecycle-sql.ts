import { sql } from 'drizzle-orm';
import type { roomStatuses } from '@daisy/protocol/room-contract';
import type { RoundStatus } from '@daisy/protocol/round';

type LifecycleStatus = (typeof roomStatuses)[number] | RoundStatus;

/** Render a fixed vocabulary member so PostgreSQL can use partial indexes. */
export const lifecycleSql = (status: LifecycleStatus) =>
  sql`${status}`.inlineParams();

export const lifecycleSqlList = (statuses: readonly LifecycleStatus[]) =>
  sql`(${sql.join(statuses.map(lifecycleSql), sql`, `)})`;
