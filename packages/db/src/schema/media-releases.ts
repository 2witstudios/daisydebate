import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import {
  guardianRelations,
  mediaReleasePolicy,
  mediaReleaseScopes,
  mediaReleaseSources,
  releaseLinkPurposes,
  releaseRequestOutcomes,
  releaseWithdrawers,
} from '@daisy/protocol/media-release';
import {
  createdAtColumn,
  mailJobChecks,
  mailJobColumns,
  oneOf,
  timestampColumn,
} from './columns';
import { organizations } from './organizations';
import { users } from './users';

const emailNormalized = (column: Parameters<typeof oneOf>[0]) =>
  sql`${column} = lower(btrim(${column})) and length(${column}) between 3 and 254`;

/**
 * A minor's request that a parent or guardian sign a media release (ADR
 * 0151). The address is the parent's, kept to send the request and its
 * reminder and to tie a signature to it; it is shown back to the minor masked.
 * An open request has no outcome and lives until `expires_at`; at most one is
 * open per minor. Deleted 30 days after it ends or expires (compliance).
 */
export const mediaReleaseRequests = pgTable(
  'media_release_requests',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    recipientEmail: text('recipient_email').notNull(),
    /** The address's keyed hash: a stop closes every open request to it. */
    recipientHash: text('recipient_hash').notNull(),
    requestedAt: timestampColumn('requested_at').notNull(),
    expiresAt: timestampColumn('expires_at').notNull(),
    outcome: text('outcome'),
    resolvedAt: timestampColumn('resolved_at'),
    sends: integer('sends').notNull().default(0),
    lastSentAt: timestampColumn('last_sent_at'),
  },
  (table) => [
    check(
      'media_release_requests_outcome_check',
      sql`(${table.outcome} is null) = (${table.resolvedAt} is null) and (${table.outcome} is null or ${oneOf(table.outcome, releaseRequestOutcomes)})`,
    ),
    check(
      'media_release_requests_email_check',
      emailNormalized(table.recipientEmail),
    ),
    check(
      'media_release_requests_hash_check',
      sql`${table.recipientHash} ~ '^[0-9a-f]{64}$'`,
    ),
    index('media_release_requests_recipient_hash_idx')
      .on(table.recipientHash)
      .where(sql`${table.outcome} is null`),
    check(
      'media_release_requests_expiry_check',
      sql`isfinite(${table.expiresAt}) and ${table.expiresAt} > ${table.requestedAt}`,
    ),
    check(
      'media_release_requests_sends_check',
      sql`${table.sends} between 0 and ${sql.raw(String(mediaReleasePolicy.sendsPerRequest))}`,
    ),
    uniqueIndex('media_release_requests_one_open')
      .on(table.userId)
      .where(sql`${table.outcome} is null`),
    index('media_release_requests_user_idx').on(
      table.userId,
      table.requestedAt,
    ),
    index('media_release_requests_ended_idx').on(
      table.resolvedAt,
      table.expiresAt,
    ),
  ],
);

/**
 * An emailed link (ADR 0019, ADR 0151): only the purpose-prefixed SHA3-256
 * digest of its token is kept. A sign link answers its request; a manage link
 * acts on the releases signed through that request's address. Each is single
 * use and expires; a request may hold several sign links (the first email, the
 * reminder, a resend), all dead once it ends.
 */
export const mediaReleaseLinks = pgTable(
  'media_release_links',
  {
    id: text('id').primaryKey(),
    tokenDigest: text('token_digest').notNull().unique(),
    purpose: text('purpose').notNull(),
    requestId: text('request_id')
      .notNull()
      .references(() => mediaReleaseRequests.id, { onDelete: 'cascade' }),
    expiresAt: timestampColumn('expires_at').notNull(),
    consumedAt: timestampColumn('consumed_at'),
    createdAt: createdAtColumn(),
  },
  (table) => [
    check(
      'media_release_links_purpose_check',
      oneOf(table.purpose, releaseLinkPurposes),
    ),
    check(
      'media_release_links_digest_check',
      sql`${table.tokenDigest} ~ '^(sign|manage):[0-9a-f]{64}$' and split_part(${table.tokenDigest}, ':', 1) = ${table.purpose}`,
    ),
    check(
      'media_release_links_expiry_check',
      sql`isfinite(${table.expiresAt})`,
    ),
    index('media_release_links_request_idx').on(table.requestId),
  ],
);

/**
 * One scope of a media release for one minor (ADR 0151): a durable,
 * revocable record of who gave it, under which wording, when, and when and by
 * whom it was withdrawn. One active release per minor per scope. A parent's
 * signature is on the row; a club's attestation is its own organisation-owned
 * row. Kept while active and for three years after withdrawal (compliance).
 */
export const mediaReleases = pgTable(
  'media_releases',
  {
    id: text('id').primaryKey(),
    /** The minor the release is about. */
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    scope: text('scope').notNull(),
    source: text('source').notNull(),
    /** The parent's request this signature answered; a club's has none. */
    requestId: text('request_id').references(() => mediaReleaseRequests.id, {
      onDelete: 'set null',
    }),
    signerName: text('signer_name'),
    signerRelation: text('signer_relation'),
    signerEmail: text('signer_email'),
    wordingVersion: text('wording_version').notNull(),
    signedAt: timestampColumn('signed_at').notNull(),
    withdrawnAt: timestampColumn('withdrawn_at'),
    withdrawnBy: text('withdrawn_by'),
    withdrawalNote: text('withdrawal_note'),
  },
  (table) => [
    check('media_releases_scope_check', oneOf(table.scope, mediaReleaseScopes)),
    check(
      'media_releases_source_check',
      oneOf(table.source, mediaReleaseSources),
    ),
    check(
      'media_releases_parent_check',
      sql`(${table.source} = 'parent') = (${table.signerName} is not null and ${table.signerRelation} is not null and ${table.signerEmail} is not null)
        and (${table.signerName} is null or char_length(${table.signerName}) between 1 and ${sql.raw(String(mediaReleasePolicy.nameMaxLength))})
        and (${table.signerRelation} is null or ${oneOf(table.signerRelation, guardianRelations)})
        and (${table.signerEmail} is null or ${emailNormalized(table.signerEmail)})`,
    ),
    check(
      'media_releases_withdrawn_check',
      sql`(${table.withdrawnAt} is null) = (${table.withdrawnBy} is null)
        and (${table.withdrawnBy} is null or ${oneOf(table.withdrawnBy, releaseWithdrawers)})
        and (${table.withdrawalNote} is null or (${table.withdrawnAt} is not null and char_length(${table.withdrawalNote}) <= ${sql.raw(String(mediaReleasePolicy.noteMaxLength))}))
        and (${table.withdrawnAt} is null or ${table.withdrawnAt} >= ${table.signedAt})`,
    ),
    check(
      'media_releases_signed_finite',
      sql`isfinite(${table.signedAt}) and char_length(${table.wordingVersion}) between 1 and 40`,
    ),
    uniqueIndex('media_releases_one_active')
      .on(table.userId, table.scope)
      .where(sql`${table.withdrawnAt} is null`),
    index('media_releases_user_idx').on(table.userId, table.signedAt),
    index('media_releases_request_idx').on(table.requestId),
    index('media_releases_withdrawn_idx').on(table.withdrawnAt),
  ],
);

/**
 * A club's attestation that it holds a parent-signed release (ADR 0151):
 * owned by the club (row-level security on its organisation, like the club
 * tables), and readable by the minor it names.
 */
export const mediaReleaseClubAttestations = pgTable(
  'media_release_club_attestations',
  {
    releaseId: text('release_id')
      .primaryKey()
      .references(() => mediaReleases.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    /** The minor, as on the release: the subject who may read this row. */
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    attestedByUserId: text('attested_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    attesterName: text('attester_name').notNull(),
    attesterRole: text('attester_role').notNull(),
  },
  (table) => [
    check(
      'media_release_club_attestations_text_check',
      sql`char_length(${table.attesterName}) between 1 and ${sql.raw(String(mediaReleasePolicy.nameMaxLength))}
        and char_length(${table.attesterRole}) between 1 and ${sql.raw(String(mediaReleasePolicy.roleMaxLength))}`,
    ),
    index('media_release_club_attestations_organization_idx').on(
      table.organizationId,
    ),
    index('media_release_club_attestations_user_idx').on(table.userId),
    index('media_release_club_attestations_attested_by_idx').on(
      table.attestedByUserId,
    ),
  ],
);

/**
 * A minor's ask that their club confirm a release it holds ("Ask my club",
 * ADR 0151): owned by the club, readable by the minor; it tells the club's
 * owner and staff.
 */
export const mediaReleaseClubAsks = pgTable(
  'media_release_club_asks',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    askedAt: timestampColumn('asked_at').notNull(),
  },
  (table) => [
    check('media_release_club_asks_finite', sql`isfinite(${table.askedAt})`),
    index('media_release_club_asks_organization_idx').on(
      table.organizationId,
      table.askedAt,
    ),
    index('media_release_club_asks_user_idx').on(table.userId, table.askedAt),
  ],
);

export const mediaReleaseMailKinds = [
  'request',
  'reminder',
  'copy',
  'manage_link',
] as const;
export const mediaReleaseMailErrorCodes = [
  'delivery',
  'delivery-unknown',
  'suppressed',
  'not-owed',
  'unconfigured',
] as const;

/**
 * One email to a parent (ADR 0151): the request, its one reminder, the signed
 * copy, or a fresh manage link. The address is read from the request at send
 * time, and the link is minted then, so a retried send never kills a link
 * already delivered. `id` is the provider idempotency key.
 */
export const mediaReleaseMails = pgTable(
  'media_release_mails',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull(),
    requestId: text('request_id')
      .notNull()
      .references(() => mediaReleaseRequests.id, { onDelete: 'cascade' }),
    ...mailJobColumns(),
  },
  (table) => [
    check(
      'media_release_mails_kind_check',
      oneOf(table.kind, mediaReleaseMailKinds),
    ),
    ...mailJobChecks('media_release_mails', table, mediaReleaseMailErrorCodes),
    index('media_release_mails_request_idx').on(table.requestId),
    index('media_release_mails_due_idx').on(table.state, table.nextAttemptAt),
    index('media_release_mails_completed_idx').on(table.completedAt),
  ],
);

/**
 * An address that asked Daisy not to send it release requests ("Don't send me
 * release requests"), by the keyed recipient hash, never the address.
 */
export const mediaReleaseStops = pgTable(
  'media_release_stops',
  {
    recipientHash: text('recipient_hash').primaryKey(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    check(
      'media_release_stops_hash_check',
      sql`${table.recipientHash} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);
