import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  pgTable,
  text,
} from 'drizzle-orm/pg-core';
import { oneOf, timestampColumn, xid8Column } from './columns';

export const serviceInstances = pgTable(
  'service_instances',
  {
    instanceId: text('instance_id').primaryKey(),
    role: text('role').$type<'web' | 'realtime'>().notNull(),
    renewedAt: timestampColumn('renewed_at')
      .notNull()
      .default(sql`statement_timestamp()`),
    deliveredThrough: bigint('delivered_through', { mode: 'bigint' }),
    deliveredThroughTxid: xid8Column('delivered_through_txid'),
  },
  (table) => [
    index('service_instances_renewed_idx').on(table.renewedAt),
    check(
      'service_instances_role_check',
      oneOf(table.role, ['web', 'realtime']),
    ),
    check(
      'service_instances_cursor_check',
      sql`(${table.role}='web' and ${table.deliveredThrough} is null and ${table.deliveredThroughTxid} is null) or (${table.role}='realtime' and ${table.deliveredThrough} is not null and ${table.deliveredThrough} >= 0 and ${table.deliveredThroughTxid} is not null and ${table.deliveredThroughTxid}::text ~ '^[0-9]+$')`,
    ),
  ],
);
const failureCauses = [
  'web_stale',
  'realtime_stale',
  'delivery_lag',
  'public_probe_failed',
  'control_worker_unknown',
  'check_in_pending',
] as const;
export const availabilitySamples = pgTable(
  'availability_samples',
  {
    at: timestampColumn('at')
      .primaryKey()
      .default(sql`statement_timestamp()`),
    healthy: boolean('healthy').notNull(),
    cause: text('cause').$type<(typeof failureCauses)[number]>(),
  },
  (table) => [
    check(
      'availability_samples_cause_check',
      sql`(${table.healthy} and ${table.cause} is null) or (not ${table.healthy} and ${table.cause} is not null and ${oneOf(table.cause, failureCauses)})`,
    ),
  ],
);
