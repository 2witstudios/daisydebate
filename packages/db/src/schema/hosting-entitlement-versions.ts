import { sql } from 'drizzle-orm';
import { tournamentHostingCoverageSchema } from '@daisy/protocol';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  unique,
} from 'drizzle-orm/pg-core';
import {
  createdAtColumn,
  jsonbColumn,
  jsonbIsObject,
  timestampColumn,
} from './columns';
import { users } from './users';
import { billingSubscriptions } from './billing-subscriptions';
import { subscriptionEvidenceSchema } from '@daisy/protocol/billing';

/** Immutable versions of the canonical account grant, not a second entitlement ledger. */
export const accountHostingEntitlementVersions = pgTable(
  'account_hosting_versions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    source: text('source').notNull(),
    version: integer('version').notNull(),
    startsAt: timestampColumn('starts_at').notNull(),
    expiresAt: timestampColumn('expires_at').notNull(),
    issuerServiceId: text('issuer_service_id'),
    issuerOperatorRef: text('issuer_operator_ref'),
    decisionReference: text('decision_reference'),
    subscriptionId: text('subscription_id').references(
      () => billingSubscriptions.id,
      { onDelete: 'restrict' },
    ),
    subscriptionObservedAt: timestampColumn('subscription_observed_at'),
    subscriptionEvidence: jsonbColumn(
      'subscription_evidence',
      subscriptionEvidenceSchema,
    ),
    coverage: jsonbColumn(
      'coverage',
      tournamentHostingCoverageSchema,
    ).notNull(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    unique('account_hosting_versions_subject_source_version_unique').on(
      table.userId,
      table.source,
      table.version,
    ),
    unique('account_hosting_versions_grant_identity_unique').on(
      table.id,
      table.userId,
      table.source,
    ),
    index('account_hosting_versions_subject_idx').on(table.userId),
    index('account_hosting_versions_issuer_idx').on(
      table.issuerServiceId,
      table.issuerOperatorRef,
    ),
    index('account_hosting_versions_subscription_idx').on(table.subscriptionId),
    check(
      'account_hosting_versions_version_positive',
      sql`${table.version} > 0`,
    ),
    check(
      'account_hosting_versions_validity_check',
      sql`isfinite(${table.startsAt}) and isfinite(${table.expiresAt}) and ${table.startsAt} < ${table.expiresAt}`,
    ),
    check(
      'account_hosting_versions_source_check',
      sql`
    (${table.source} = 'administrative' and ${table.issuerServiceId} is not null and length(btrim(${table.issuerServiceId})) between 1 and 80 and ${table.issuerOperatorRef} is not null and ${table.issuerOperatorRef} ~ '^[a-z0-9]{24}$'
      and ${table.decisionReference} is not null and length(btrim(${table.decisionReference})) between 1 and 500
      and ${table.subscriptionId} is null and ${table.subscriptionObservedAt} is null and ${table.subscriptionEvidence} is null)
    or (${table.source} = 'subscription' and ${table.subscriptionId} is not null and ${table.subscriptionObservedAt} is not null and isfinite(${table.subscriptionObservedAt}) and ${table.subscriptionEvidence} is not null
      and ${table.issuerServiceId} is null and ${table.issuerOperatorRef} is null and ${table.decisionReference} is null)`,
    ),
    check(
      'account_hosting_versions_paid_evidence',
      sql`${table.source} <> 'subscription' or coalesce(
    jsonb_typeof(${table.subscriptionEvidence}) = 'object'
    and ${table.subscriptionEvidence}->'settlement'->>'kind' = 'paid'
    and ${table.subscriptionEvidence}->'settlement'->'period'->>'subscriptionId' = ${table.subscriptionId}
    and (${table.subscriptionEvidence}->'settlement'->'period'->>'startsAt')::timestamptz <= ${table.startsAt}
    and ${table.expiresAt} <= (${table.subscriptionEvidence}->'settlement'->'period'->>'endsAt')::timestamptz,false)`,
    ),
    jsonbIsObject('account_hosting_versions', table.coverage),
    jsonbIsObject('account_hosting_versions', table.subscriptionEvidence),
    check(
      'account_hosting_versions_capacity_positive',
      sql`coalesce(jsonb_typeof(${table.coverage}->'sponsorConcurrencyLimit') = 'number' and (${table.coverage}->>'sponsorConcurrencyLimit')::numeric > 0 and trunc((${table.coverage}->>'sponsorConcurrencyLimit')::numeric) = (${table.coverage}->>'sponsorConcurrencyLimit')::numeric and jsonb_typeof(${table.coverage}->'tournamentConcurrencyLimit') = 'number' and (${table.coverage}->>'tournamentConcurrencyLimit')::numeric > 0 and trunc((${table.coverage}->>'tournamentConcurrencyLimit')::numeric) = (${table.coverage}->>'tournamentConcurrencyLimit')::numeric,false)`,
    ),
    check(
      'account_hosting_versions_tournaments_array',
      sql`coalesce(jsonb_typeof(${table.coverage}->'tournamentIds') = 'array',false)`,
    ),
  ],
);
