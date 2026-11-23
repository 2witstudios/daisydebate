import { listedWord, listedWords } from '../lifecycle-sql';
import {
  consentMethods,
  consentRoles,
  guardianInvitationStatuses,
  guardianLinkActivations,
  guardianLinkStatuses,
  guardianNoticeKinds,
} from '@daisy/protocol/guardians';
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import {
  createdAtColumn,
  notBefore,
  oneOf,
  timestampColumn,
  updatedAtColumn,
  versionColumn,
  versionPositive,
} from './columns';
import { lobbies } from './lobbies';
import { seasons } from './seasons';
import { constantText } from './tenant-keys';
import { users } from './users';

export const guardianConsentEvidence = pgTable(
  'guardian_consent_evidence',
  {
    id: text('id').primaryKey(),
    personUserId: text('person_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    role: text('role').$type<(typeof consentRoles)[number]>().notNull(),
    method: text('method').$type<(typeof consentMethods)[number]>().notNull(),
    noticeKind: text('notice_kind')
      .$type<(typeof guardianNoticeKinds)[number]>()
      .notNull(),
    noticeVersion: text('notice_version').notNull(),
    noticeDigest: text('notice_digest').notNull(),
    recordedAt: timestampColumn('recorded_at').notNull(),
  },
  (table) => [
    unique('guardian_evidence_signer_unique').on(
      table.id,
      table.personUserId,
      table.role,
    ),
    index('guardian_evidence_person_idx').on(table.personUserId),
    check(
      'guardian_evidence_method_check',
      oneOf(table.method, consentMethods),
    ),
    check(
      'guardian_evidence_notice_check',
      sql`(${table.role} = 'guardian' and ${table.noticeKind} = 'parental-consent' and ${table.method} <> ${listedWord(consentMethods, 'confirmed-link')})
        or (${table.role} = 'child' and ${table.noticeKind} = 'child-confirmation' and ${table.method} = ${listedWord(consentMethods, 'confirmed-link')})`,
    ),
    check(
      'guardian_evidence_version_check',
      sql`char_length(${table.noticeVersion}) between 1 and 40`,
    ),
    check(
      'guardian_evidence_digest_check',
      sql`${table.noticeDigest} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);

export const guardianLinks = pgTable(
  'guardian_links',
  {
    id: text('id').primaryKey(),
    guardianUserId: text('guardian_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    minorUserId: text('minor_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    guardianConsentId: text('guardian_consent_id').notNull(),
    guardianRole: constantText('guardian_role', 'guardian'),
    childConfirmationId: text('child_confirmation_id'),
    childRole: constantText('child_role', 'child'),
    status: text('status')
      .$type<(typeof guardianLinkStatuses)[number]>()
      .notNull(),
    activation:
      text('activation').$type<(typeof guardianLinkActivations)[number]>(),
    activatedAt: timestampColumn('activated_at'),
    closedAt: timestampColumn('closed_at'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    version: versionColumn(),
  },
  (table) => [
    unique('guardian_links_id_people_unique').on(
      table.id,
      table.guardianUserId,
      table.minorUserId,
    ),
    uniqueIndex('guardian_links_open_pair_unique')
      .on(table.guardianUserId, table.minorUserId)
      .where(
        sql`${table.status} in ${listedWords(guardianLinkStatuses, ['requested', 'active'])}`,
      ),
    index('guardian_links_guardian_user_idx').on(table.guardianUserId),
    index('guardian_links_minor_user_idx').on(table.minorUserId),
    index('guardian_links_guardian_evidence_idx').on(
      table.guardianConsentId,
      table.guardianUserId,
      table.guardianRole,
    ),
    index('guardian_links_child_evidence_idx').on(
      table.childConfirmationId,
      table.minorUserId,
      table.childRole,
    ),
    foreignKey({
      name: 'guardian_links_guardian_evidence_fk',
      columns: [
        table.guardianConsentId,
        table.guardianUserId,
        table.guardianRole,
      ],
      foreignColumns: [
        guardianConsentEvidence.id,
        guardianConsentEvidence.personUserId,
        guardianConsentEvidence.role,
      ],
    }).onDelete('restrict'),
    foreignKey({
      name: 'guardian_links_child_evidence_fk',
      columns: [table.childConfirmationId, table.minorUserId, table.childRole],
      foreignColumns: [
        guardianConsentEvidence.id,
        guardianConsentEvidence.personUserId,
        guardianConsentEvidence.role,
      ],
    }).onDelete('restrict'),
    check(
      'guardian_links_status_check',
      oneOf(table.status, guardianLinkStatuses),
    ),
    check(
      'guardian_links_activation_check',
      oneOf(table.activation, guardianLinkActivations),
    ),
    check(
      'guardian_links_two_people',
      sql`${table.guardianUserId} <> ${table.minorUserId}`,
    ),
    check(
      'guardian_links_state_check',
      sql`(${table.status} in ${listedWords(guardianLinkStatuses, ['active', 'ended'])}) = (${table.activatedAt} is not null)
        and (${table.activatedAt} is null) = (${table.activation} is null)
        and (coalesce(${table.activation} = ${listedWord(guardianLinkActivations, 'child-confirmed')}, false)) = (${table.childConfirmationId} is not null)
        and (${table.status} in ${listedWords(guardianLinkStatuses, ['refused', 'cancelled', 'ended'])}) = (${table.closedAt} is not null)
        and (${notBefore(table.activatedAt, table.createdAt)})
        and (${notBefore(table.closedAt, table.createdAt)})
        and (${notBefore(table.closedAt, table.activatedAt)})`,
    ),
    versionPositive('guardian_links', table.version),
  ],
);

export const childAccountRequests = pgTable(
  'child_account_requests',
  {
    id: text('id').primaryKey(),
    guardianUserId: text('guardian_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    guardianConsentId: text('guardian_consent_id').notNull(),
    guardianRole: constantText('guardian_role', 'guardian'),
    firstName: text('first_name'),
    birthMonth: text('birth_month'),
    email: text('email'),
    status: text('status')
      .$type<(typeof guardianInvitationStatuses)[number]>()
      .notNull(),
    claimedUserId: text('claimed_user_id').references(() => users.id, {
      onDelete: 'restrict',
    }),
    requestedLinkId: text('requested_link_id').references(
      () => guardianLinks.id,
      { onDelete: 'restrict' },
    ),
    createdAt: createdAtColumn(),
    expiresAt: timestampColumn('expires_at').notNull(),
    closedAt: timestampColumn('closed_at'),
  },
  (table) => [
    foreignKey({
      name: 'child_requests_guardian_evidence_fk',
      columns: [
        table.guardianConsentId,
        table.guardianUserId,
        table.guardianRole,
      ],
      foreignColumns: [
        guardianConsentEvidence.id,
        guardianConsentEvidence.personUserId,
        guardianConsentEvidence.role,
      ],
    }).onDelete('restrict'),
    index('child_requests_guardian_idx').on(table.guardianUserId),
    index('child_requests_email_idx').on(table.email),
    index('child_requests_claimed_user_idx').on(table.claimedUserId),
    index('child_requests_requested_link_idx').on(table.requestedLinkId),
    index('child_requests_guardian_evidence_idx').on(
      table.guardianConsentId,
      table.guardianUserId,
      table.guardianRole,
    ),
    check(
      'child_requests_status_check',
      oneOf(table.status, guardianInvitationStatuses),
    ),
    check(
      'child_requests_state_check',
      sql`(${table.status} = ${listedWord(guardianInvitationStatuses, 'open')}) = (${table.closedAt} is null)
        and (${table.status} = ${listedWord(guardianInvitationStatuses, 'claimed')}) = (${table.claimedUserId} is not null)
        and ((${table.status} in ${listedWords(guardianInvitationStatuses, ['open', 'linked'])}) = (num_nonnulls(${table.firstName}, ${table.birthMonth}, ${table.email}) = 3))
        and (num_nonnulls(${table.firstName}, ${table.birthMonth}, ${table.email}) in (0, 3))
        and (${table.requestedLinkId} is null or ${table.status} in ${listedWords(guardianInvitationStatuses, ['linked', 'cancelled'])})
        and ${table.claimedUserId} is distinct from ${table.guardianUserId}
        and ${table.expiresAt} > ${table.createdAt}
        and (${notBefore(table.closedAt, table.createdAt)})`,
    ),
    check(
      'child_requests_details_check',
      sql`char_length(${table.firstName}) between 1 and 40
        and ${table.birthMonth} ~ '^[1-9][0-9]{3}-(0[1-9]|1[0-2])$'
        and ${table.email} = lower(btrim(${table.email}))`,
    ),
  ],
);

/** A lobby permission belongs to the two accounts of its guardian link. */
export const restrictionLobbies = pgTable(
  'restriction_lobbies',
  {
    guardianLinkId: text('guardian_link_id').notNull(),
    guardianUserId: text('guardian_user_id').notNull(),
    minorUserId: text('minor_user_id').notNull(),
    lobbyId: text('lobby_id')
      .notNull()
      .references(() => lobbies.id, { onDelete: 'cascade' }),
    createdAt: createdAtColumn(),
    signedAt: timestampColumn('signed_at'),
    waiverVersion: text('waiver_version'),
    waiverDigest: text('waiver_digest'),
  },
  (table) => [
    primaryKey({ columns: [table.guardianLinkId, table.lobbyId] }),
    index('restriction_lobbies_link_idx').on(
      table.guardianLinkId,
      table.guardianUserId,
      table.minorUserId,
    ),
    index('restriction_lobbies_lobby_idx').on(table.lobbyId),
    check(
      'restriction_lobbies_signature_check',
      sql`num_nonnulls(${table.signedAt}, ${table.waiverVersion}, ${table.waiverDigest}) in (0, 3)
        and (${notBefore(table.signedAt, table.createdAt)})
        and char_length(${table.waiverVersion}) between 1 and 64
        and ${table.waiverDigest} ~ '^[0-9a-f]{64}$'`,
    ),
    foreignKey({
      name: 'restriction_lobbies_guardian_link_fk',
      columns: [table.guardianLinkId, table.guardianUserId, table.minorUserId],
      foreignColumns: [
        guardianLinks.id,
        guardianLinks.guardianUserId,
        guardianLinks.minorUserId,
      ],
    }).onDelete('cascade'),
  ],
);

/** An addressed guardian's immutable ranked waiver for one lobby season. */
export const restrictionLobbyWaivers = pgTable(
  'restriction_lobby_waivers',
  {
    guardianLinkId: text('guardian_link_id').notNull(),
    guardianUserId: text('guardian_user_id').notNull(),
    minorUserId: text('minor_user_id').notNull(),
    lobbyId: text('lobby_id').notNull(),
    seasonId: text('season_id').notNull(),
    waiverVersion: text('waiver_version').notNull(),
    waiverDigest: text('waiver_digest').notNull(),
    signedAt: timestampColumn('signed_at')
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    primaryKey({
      columns: [
        table.guardianLinkId,
        table.lobbyId,
        table.seasonId,
        table.waiverVersion,
      ],
    }),
    index('restriction_lobby_waivers_guardian_link_idx').on(
      table.guardianLinkId,
      table.guardianUserId,
      table.minorUserId,
    ),
    index('restriction_lobby_waivers_season_idx').on(
      table.seasonId,
      table.lobbyId,
    ),
    foreignKey({
      name: 'restriction_lobby_waivers_permission_fk',
      columns: [table.guardianLinkId, table.lobbyId],
      foreignColumns: [
        restrictionLobbies.guardianLinkId,
        restrictionLobbies.lobbyId,
      ],
    }).onDelete('restrict'),
    foreignKey({
      name: 'restriction_lobby_waivers_guardian_link_fk',
      columns: [table.guardianLinkId, table.guardianUserId, table.minorUserId],
      foreignColumns: [
        guardianLinks.id,
        guardianLinks.guardianUserId,
        guardianLinks.minorUserId,
      ],
    }).onDelete('restrict'),
    foreignKey({
      name: 'restriction_lobby_waivers_season_fk',
      columns: [table.seasonId, table.lobbyId],
      foreignColumns: [seasons.id, seasons.lobbyId],
    }).onDelete('restrict'),
    check(
      'restriction_lobby_waivers_evidence_check',
      sql`char_length(${table.waiverVersion}) between 1 and 64 and ${table.waiverDigest} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);
