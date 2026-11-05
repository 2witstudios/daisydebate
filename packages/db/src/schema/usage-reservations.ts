import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import {
  usageKinds,
  usageSourceSchema,
  usageStateSchema,
} from '@daisy/protocol/billing';
import { jsonbColumn, jsonbIsObject, oneOf, timestampColumn } from './columns';
import { actors } from './actors';
import { rounds } from './rounds';

/**
 * One allowance ledger, separate from each provider job's execution evidence.
 * Attribution is immutable at admission. Source/period and a released original
 * free binding survive terminal work; replay never creates new dispatch authority.
 */
export const usageReservations = pgTable(
  'usage_reservations',
  {
    id: text('id').primaryKey(),
    actorId: text('actor_id')
      .notNull()
      .references(() => actors.id, { onDelete: 'restrict' }),
    roundId: text('round_id')
      .notNull()
      .references(() => rounds.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    source: jsonbColumn('source', usageSourceSchema).notNull(),
    state: jsonbColumn('state', usageStateSchema).notNull(),
    reservedAt: timestampColumn('reserved_at')
      .notNull()
      .default(sql`clock_timestamp()`),
    /** Immutable identity of the original free bot Round, including after a refund. */
    bindsFreeJudge: boolean('binds_free_judge').notNull().default(false),
    /** DEC-367 retires only a proven-undispatched abandoned bundle atomically. */
    bindingReleasedAt: timestampColumn('binding_released_at'),
  },
  (table) => [
    uniqueIndex('usage_reservations_actor_round_kind_unique').on(
      table.actorId,
      table.roundId,
      table.kind,
    ),
    index('usage_reservations_actor_source_idx').on(
      table.actorId,
      table.kind,
      table.source,
    ),
    check(
      'usage_reservations_reserved_at_check',
      sql`isfinite(${table.reservedAt})`,
    ),
    check(
      'usage_reservations_state_check',
      sql`coalesce(case ${table.state}->>'kind'
      when 'reserved' then ${table.state}='{"kind":"reserved"}'::jsonb
      when 'released' then ${table.state}-array['kind','releasedAt']='{}'::jsonb
        and jsonb_typeof(${table.state}->'releasedAt')='string'
        and isfinite((${table.state}->>'releasedAt')::timestamptz)
        and (${table.state}->>'releasedAt')::timestamptz>=${table.reservedAt}
      when 'dispatched' then ${table.state}-array['kind','countedAt']='{}'::jsonb
      when 'unknown' then ${table.state}-array['kind','countedAt']='{}'::jsonb
      when 'delivered' then ${table.state}-array['kind','countedAt']='{}'::jsonb
      when 'refunded' then ${table.state}-array['kind','countedAt','refundedAt']='{}'::jsonb
        and jsonb_typeof(${table.state}->'refundedAt')='string'
        and isfinite((${table.state}->>'refundedAt')::timestamptz)
        and (${table.state}->>'refundedAt')::timestamptz>=(${table.state}->>'countedAt')::timestamptz
      when 'credited' then ${table.kind}='ai_round'
        and ${table.state}-array['kind','countedAt','creditedAt','provenance','providerOutcome']='{}'::jsonb
        and jsonb_typeof(${table.state}->'creditedAt')='string'
        and isfinite((${table.state}->>'creditedAt')::timestamptz)
        and (${table.state}->>'creditedAt')::timestamptz>=(${table.state}->>'countedAt')::timestamptz
        and ${table.state}->>'providerOutcome' in ('dispatched','unknown','delivered','definite_failure')
        and jsonb_typeof(${table.state}->'provenance')='object'
        and case ${table.state}->'provenance'->>'kind'
          when 'recovery_bound' then (${table.state}->'provenance')-array['kind','incidentId']='{}'::jsonb
            and ${table.state}->'provenance'->>'incidentId' ~ '^[a-z][a-z0-9]{23}$'
          when 'capture_shortfall' then (${table.state}->'provenance')-array['kind','commandId','freezeRevision']='{}'::jsonb
            and ${table.state}->'provenance'->>'commandId' ~ '^[a-z][a-z0-9]{23}$'
            and jsonb_typeof(${table.state}->'provenance'->'freezeRevision')='number'
            and ${table.state}->'provenance'->>'freezeRevision' ~ '^[1-9][0-9]*$'
          else false end
      else false end, false)`,
    ),
    check(
      'usage_reservations_count_check',
      sql`coalesce(case
      when ${table.state}->>'kind' in ('reserved','released') then not (${table.state} ? 'countedAt')
      else jsonb_typeof(${table.state}->'countedAt')='string'
        and isfinite((${table.state}->>'countedAt')::timestamptz)
        and (${table.state}->>'countedAt')::timestamptz >= ${table.reservedAt} end, false)`,
    ),
    check(
      'usage_reservations_source_check',
      sql`coalesce(case ${table.source}->>'kind'
      when 'lifetime' then ${table.source}='{"kind":"lifetime"}'::jsonb
      when 'beta' then ${table.source}-array['kind','startsAt','endsAt']='{}'::jsonb
      when 'subscription' then ${table.source}-array['kind','subscriptionId','startsAt','endsAt']='{}'::jsonb
        and ${table.source}->>'subscriptionId' ~ '^[a-z][a-z0-9]{23}$'
      else false end, false) and coalesce(
        ${table.source}->>'kind'='lifetime' or (
          jsonb_typeof(${table.source}->'startsAt')='string' and jsonb_typeof(${table.source}->'endsAt')='string'
          and isfinite((${table.source}->>'startsAt')::timestamptz) and isfinite((${table.source}->>'endsAt')::timestamptz)
          and (${table.source}->>'startsAt')::timestamptz < (${table.source}->>'endsAt')::timestamptz), false)`,
    ),
    check(
      'usage_reservations_binding_check',
      sql`
      (not ${table.bindsFreeJudge} or (${table.kind}='ai_round' and ${table.source}->>'kind'='lifetime')) and
      (${table.bindingReleasedAt} is null or (${table.bindsFreeJudge} and ${table.state}->>'kind'='released'
        and ${table.bindingReleasedAt}>=${table.reservedAt}))`,
    ),
    uniqueIndex('usage_reservations_free_binding_unique')
      .on(table.actorId)
      .where(
        sql`${table.bindsFreeJudge} and ${table.bindingReleasedAt} is null`,
      ),
    jsonbIsObject('usage_reservations', table.source),
    jsonbIsObject('usage_reservations', table.state),
    index('usage_reservations_round_idx').on(table.roundId),
    check('usage_reservations_kind_check', oneOf(table.kind, usageKinds)),
  ],
);
