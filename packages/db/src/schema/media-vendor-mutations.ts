import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { jsonbColumn, jsonbIsObject, timestampColumn } from './columns';
import { mediaSessions } from './media-sessions';

const intentSchema = z.union([
  z.object({}).strict(),
  z
    .object({
      publish: z
        .array(z.enum(['camera', 'microphone']))
        .max(2)
        .refine((items) => new Set(items).size === items.length),
      subscribe: z.boolean(),
      hidden: z.boolean(),
      capture: z.literal(false),
    })
    .strict(),
]);

/** Permission intent only; credentials and capture-agent permissions never persist here. */
export const mediaVendorMutations = pgTable(
  'media_vendor_mutations',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => mediaSessions.id, { onDelete: 'cascade' }),
    epoch: integer('epoch').notNull(),
    kind: text('kind', {
      enum: ['create', 'permissions', 'delete'],
    }).notNull(),
    identity: text('identity'),
    dispatchedAt: timestampColumn('dispatched_at')
      .notNull()
      .default(sql`statement_timestamp()`),
    settledAt: timestampColumn('settled_at'),
    outcome: text('outcome', { enum: ['succeeded', 'failed'] }),
    payload: jsonbColumn('payload', intentSchema).notNull(),
  },
  (table) => [
    jsonbIsObject('media_vendor_mutations', table.payload),
    index('media_vendor_mutations_session_settled_idx').on(
      table.sessionId,
      table.settledAt,
    ),
    index('media_vendor_mutations_pending_idx')
      .on(table.sessionId, table.dispatchedAt)
      .where(sql`${table.settledAt} is null`),
    check('media_vendor_mutations_epoch_check', sql`${table.epoch} >= 0`),
    check(
      'media_vendor_mutations_kind_check',
      sql`${table.kind} in ('create','permissions','delete')`,
    ),
    check(
      'media_vendor_mutations_identity_check',
      sql`(${table.identity} is not null) = (${table.kind} = 'permissions')`,
    ),
    check(
      'media_vendor_mutations_settlement_check',
      sql`(${table.settledAt} is null) = (${table.outcome} is null) and (${table.outcome} is null or ${table.outcome} in ('succeeded','failed')) and (${table.settledAt} is null or ${table.settledAt} >= ${table.dispatchedAt})`,
    ),
    check(
      'media_vendor_mutations_payload_check',
      sql`case when ${table.kind} = 'permissions' then
    jsonb_typeof(${table.payload}) = 'object'
    and ${table.payload} ?& array['publish','subscribe','hidden','capture']
    and (${table.payload} - 'publish' - 'subscribe' - 'hidden' - 'capture') = '{}'::jsonb
    and case when jsonb_typeof(${table.payload}->'publish') = 'array' then
      jsonb_array_length(${table.payload}->'publish') <= 2
      and (${table.payload}->'publish') <@ '["camera","microphone"]'::jsonb
      and (jsonb_array_length(${table.payload}->'publish') < 2 or ${table.payload}->'publish'->0 is distinct from ${table.payload}->'publish'->1)
    else false end
    and jsonb_typeof(${table.payload}->'subscribe') = 'boolean'
    and jsonb_typeof(${table.payload}->'hidden') = 'boolean'
    and ${table.payload}->'capture' = 'false'::jsonb
    else ${table.payload} = '{}'::jsonb end`,
    ),
  ],
);
