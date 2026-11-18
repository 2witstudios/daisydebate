import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import {
  leagueRequestDivisions,
  leagueRequestLimits,
  leagueRequestSchoolCounts,
  leagueRequestSeasonCounts,
  leagueRequestStyles,
} from '@daisy/protocol/league-request';
import { mailJobChecks, mailJobColumns, oneOf } from './columns';

export const leagueRequestNoticeErrorCodes = [
  'delivery',
  'delivery-unknown',
  'suppressed',
  'not-owed',
] as const;

/**
 * League requests (PYL-17): someone who runs a league asks Daisy to set one
 * up with them, signed in or not. The row is the request and its one owner
 * notice: the mail job columns carry that email's delivery, which the web
 * mail worker sends to the configured owner address, reading the request
 * fresh at send time. A stored request never changes: its id is an
 * identifier, not an edit credential (ADR 0018). It holds the contact's personal data and is deleted
 * 365 days after it was made (compliance: league requests). `id` is chosen
 * when the form is shown, so a request sent twice unchanged is stored once,
 * and it is the notice's provider idempotency key.
 */
export const leagueRequests = pgTable(
  'league_requests',
  {
    id: text('id').primaryKey(),
    /** The id the sent form carried; its first version is stored under it. */
    formId: text('form_id').notNull(),
    /** SHA3-256 of the request's fields: one row per version of a form. */
    fieldsDigest: text('fields_digest').notNull(),
    leagueName: text('league_name').notNull(),
    schools: text('schools').notNull(),
    seasons: text('seasons').notNull(),
    style: text('style').notNull(),
    divisions: text('divisions').notNull(),
    needs: text('needs').notNull(),
    contactName: text('contact_name').notNull(),
    contactRole: text('contact_role').notNull(),
    contactEmail: text('contact_email').notNull(),
    contactPhone: text('contact_phone'),
    ...mailJobColumns(),
  },
  (table) => [
    check(
      'league_requests_schools_check',
      oneOf(table.schools, leagueRequestSchoolCounts),
    ),
    check(
      'league_requests_seasons_check',
      oneOf(table.seasons, leagueRequestSeasonCounts),
    ),
    check(
      'league_requests_style_check',
      oneOf(table.style, leagueRequestStyles),
    ),
    check(
      'league_requests_divisions_check',
      oneOf(table.divisions, leagueRequestDivisions),
    ),
    check(
      'league_requests_text_check',
      sql`char_length(${table.leagueName}) between 1 and ${sql.raw(String(leagueRequestLimits.leagueName))}
        and char_length(${table.needs}) <= ${sql.raw(String(leagueRequestLimits.needs))}
        and char_length(${table.contactName}) between 1 and ${sql.raw(String(leagueRequestLimits.contactName))}
        and char_length(${table.contactRole}) between 1 and ${sql.raw(String(leagueRequestLimits.contactRole))}
        and char_length(${table.contactEmail}) between 3 and ${sql.raw(String(leagueRequestLimits.contactEmail))}
        and (${table.contactPhone} is null or char_length(${table.contactPhone}) between 1 and ${sql.raw(String(leagueRequestLimits.contactPhone))})`,
    ),
    ...mailJobChecks('league_requests', table, leagueRequestNoticeErrorCodes),
    uniqueIndex('league_requests_version_idx').on(
      table.formId,
      table.fieldsDigest,
    ),
    check(
      'league_requests_digest_check',
      sql`${table.fieldsDigest} ~ '^[0-9a-f]{64}$'`,
    ),
    index('league_requests_due_idx').on(table.state, table.nextAttemptAt),
    index('league_requests_created_idx').on(table.createdAt),
  ],
);
