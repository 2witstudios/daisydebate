import {
  boolean,
  check,
  customType,
  pgTable,
  primaryKey,
  text,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { oneOf } from './columns';
const xid8 = customType<{ data: string; driverData: string }>({
  dataType: () => 'xid8',
});
/** Transaction-local dirty resource keys; a deferred owner flush removes them before commit. */
export const observationPending = pgTable(
  'resource_observation_pending',
  {
    transactionId: xid8('transaction_id').notNull(),
    kind: text('kind').notNull(),
    resourceId: text('resource_id').notNull(),
    disclose: boolean('disclose').notNull(),
    purge: boolean('purge').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.transactionId, t.kind, t.resourceId] }),
    check(
      'observation_pending_kind',
      oneOf(t.kind, ['room', 'round', 'channel', 'inbox']),
    ),
    check('observation_pending_id', sql`${t.resourceId} ~ '^[a-z0-9]{24}$'`),
  ],
);
