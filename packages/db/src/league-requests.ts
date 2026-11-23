import { mailJobStates } from './schema/columns';
import { listedWord } from './lifecycle-sql';
import { commandDigest } from '@daisy/digest';
import type { LeagueRequest } from '@daisy/protocol/league-request';
import {
  leagueRequestDivisions,
  leagueRequestSchoolCounts,
  leagueRequestSeasonCounts,
  leagueRequestStyles,
} from '@daisy/protocol/league-request';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { instrumented, type DatabaseEventSink } from './instrumented';
import {
  mailQueue,
  type MailJobClaimInput,
  type MailJobOutcome,
} from './mail-queue';
import { query } from './raw-rows';
import { deleteExpiredBatch, type RetentionBatch } from './retention';
import {
  leagueRequestNoticeErrorCodes,
  leagueRequests,
} from './schema/league-requests';
import type { TxSource } from './tx';

/**
 * A lapsed lease is not marked `delivery-unknown`: the next claim sends the
 * notice again, and only the provider idempotency key (the request id)
 * keeps that resend from reaching the owner twice.
 */
const noticeQueue = mailQueue(leagueRequests, {
  unknownAfterLapse: sql`false`,
});

export type LeagueRequestNoticeClaim = {
  readonly id: string;
  readonly attempts: number;
  /** The lease holder's bearer token; only its SHA3 digest is stored. */
  readonly token: string;
};

/** What a claimed notice should say right now, read fresh at send time. */
export type LeagueRequestNotice =
  | {
      readonly kind: 'request';
      readonly request: Omit<LeagueRequest, 'v' | 'requestId'> & {
        readonly id: string;
        /** UTC ISO instant the request was made. */
        readonly receivedAt: string;
      };
    }
  /** The request was deleted (retention) before its notice went. */
  | { readonly kind: 'gone' };

export type LeagueRequestNoticeOutcome = MailJobOutcome<
  (typeof leagueRequestNoticeErrorCodes)[number]
>;

const claimRow = z.object({
  id: z.string(),
  attempts: z.coerce.number().int().positive(),
});

const requestRow = z.object({
  id: z.string(),
  league_name: z.string(),
  schools: z.enum(leagueRequestSchoolCounts),
  seasons: z.enum(leagueRequestSeasonCounts),
  style: z.enum(leagueRequestStyles),
  divisions: z.enum(leagueRequestDivisions),
  needs: z.string(),
  contact_name: z.string(),
  contact_role: z.string(),
  contact_email: z.string(),
  contact_phone: z.string().nullable(),
  received_at: z.string(),
});

/**
 * One digest of a request's own fields (SHA3-256 over their JSON, in a
 * fixed order), so a sent form's every version is found by (form id,
 * digest) without comparing columns, and a resend of any version is stored
 * once.
 */
const leagueRequestDigest = (request: LeagueRequest): string =>
  commandDigest([
    request.leagueName,
    request.schools,
    request.seasons,
    request.style,
    request.divisions,
    request.needs,
    request.contactName,
    request.contactRole,
    request.contactEmail,
    request.contactPhone,
  ]);

/**
 * League requests (PYL-17): stored once per request id, then told to the
 * owner through the shared mail job lifecycle (`mailQueue`). Provider calls
 * happen outside any transaction; only the current lease holder settles.
 */
export function leagueRequestOperations({
  database,
  eventSink,
}: {
  readonly database: TxSource;
  readonly eventSink: DatabaseEventSink | undefined;
}) {
  return {
    /**
     * Whether this exact version of a sent form is already stored: a resend
     * after a lost answer, which needs no new allowance and changes nothing.
     */
    leagueRequestUnchanged: (request: LeagueRequest): Promise<boolean> =>
      instrumented(eventSink, 'leagueRequestUnchanged', async () => {
        const rows = await query(
          database,
          z.object({ present: z.literal(1) }),
          sql`select 1 as present from league_requests where form_id = ${request.requestId}
            and fields_digest = ${leagueRequestDigest(request)}`,
        );
        return rows.length === 1;
      }),
    /**
     * Stores a validated request with its email queued now, once per
     * version of a sent form: (form id, digest) is unique, so a resend of
     * any version after a lost answer is left as it is. The form's first
     * version is stored under the form's id; a changed version is a new
     * request under `newId`. A stored request never changes, because a
     * request id is an identifier, not an edit credential (ADR 0018), so
     * holding one never lets anyone rewrite the contact the owner replies
     * to. The owner then has each version, the latest last.
     */
    recordLeagueRequest: (
      request: LeagueRequest,
      newId: string,
    ): Promise<void> =>
      instrumented(eventSink, 'recordLeagueRequest', async () => {
        const insert = (id: string) =>
          query(
            database,
            z.object({ id: z.string() }),
            sql`insert into league_requests (
              id, form_id, fields_digest, league_name, schools, seasons, style,
              divisions, needs, contact_name, contact_role, contact_email,
              contact_phone, next_attempt_at
            ) values (
              ${id}, ${request.requestId}, ${leagueRequestDigest(request)},
              ${request.leagueName}, ${request.schools},
              ${request.seasons}, ${request.style}, ${request.divisions},
              ${request.needs}, ${request.contactName}, ${request.contactRole},
              ${request.contactEmail}, ${request.contactPhone === '' ? null : request.contactPhone},
              clock_timestamp()
            ) on conflict do nothing returning id`,
          );
        // The form's id is taken only by its first version; any version
        // already stored makes the second insert a no-op on (form, digest).
        if ((await insert(request.requestId)).length === 0) await insert(newId);
      }),
    claimLeagueRequestNotices: (
      input: MailJobClaimInput,
    ): Promise<readonly LeagueRequestNoticeClaim[]> =>
      instrumented(eventSink, 'claimLeagueRequestNotices', async () =>
        (
          await noticeQueue.claimDue(
            database,
            input,
            sql`id, attempts`,
            claimRow,
          )
        ).map(({ row, token }) => ({ ...row, token })),
      ),
    readLeagueRequestNotice: (id: string): Promise<LeagueRequestNotice> =>
      instrumented(eventSink, 'readLeagueRequestNotice', async () => {
        const [row] = await query(
          database,
          z.object({
            id: z.string(),
            league_name: z.string(),
            schools: z.string(),
            seasons: z.string(),
            style: z.string(),
            divisions: z.string(),
            needs: z.string(),
            contact_name: z.string(),
            contact_role: z.string(),
            contact_email: z.string(),
            contact_phone: z.string().nullable(),
            received_at: z.string(),
          }),
          sql`select id, league_name, schools, seasons, style, divisions, needs,
              contact_name, contact_role, contact_email, contact_phone,
              to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as received_at
            from league_requests where id = ${id}`,
        );
        if (!row) return { kind: 'gone' };
        const stored = requestRow.parse(row);
        return {
          kind: 'request',
          request: {
            id: stored.id,
            leagueName: stored.league_name,
            schools: stored.schools,
            seasons: stored.seasons,
            style: stored.style,
            divisions: stored.divisions,
            needs: stored.needs,
            contactName: stored.contact_name,
            contactRole: stored.contact_role,
            contactEmail: stored.contact_email,
            contactPhone: stored.contact_phone ?? '',
            receivedAt: stored.received_at,
          },
        };
      }),
    /** False when the lease lapsed and another worker may now hold the notice. */
    settleLeagueRequestNotice: (input: {
      readonly id: string;
      readonly token: string;
      readonly outcome: LeagueRequestNoticeOutcome;
    }): Promise<boolean> =>
      instrumented(eventSink, 'settleLeagueRequestNotice', () =>
        noticeQueue.settle(database, input),
      ),
    /**
     * Deletes requests made before the cutoff (the sweep passes 365 days),
     * whether their notice went or not, except one a worker holds now.
     */
    purgeExpiredLeagueRequests: (batch: RetentionBatch): Promise<number> =>
      instrumented(eventSink, 'purgeExpiredLeagueRequests', () =>
        deleteExpiredBatch(
          database,
          {
            table: leagueRequests,
            key: leagueRequests.id,
            at: leagueRequests.createdAt,
            eligible: sql`${leagueRequests.state} <> ${listedWord(mailJobStates, 'leased')}`,
          },
          batch,
        ),
      ),
  };
}
