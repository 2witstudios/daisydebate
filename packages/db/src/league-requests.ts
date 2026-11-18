import type { LeagueRequest } from '@daisy/protocol/league-request';
import {
  leagueRequestDivisions,
  leagueRequestSchoolCounts,
  leagueRequestSeasonCounts,
  leagueRequestStyles,
} from '@daisy/protocol/league-request';
import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { z } from 'zod';
import { instrumented, type DatabaseEventSink } from './instrumented';
import {
  mailQueue,
  type MailJobClaimInput,
  type MailJobOutcome,
} from './mail-queue';
import { rowsOf } from './raw-rows';
import { deleteExpiredBatch, type RetentionBatch } from './retention';
import {
  leagueRequestNoticeErrorCodes,
  leagueRequests,
} from './schema/league-requests';

type Database = Pick<BunSQLDatabase, 'transaction' | 'execute'>;

/** A league request's owner notice is never sent twice by a lapsed lease. */
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
 * League requests (PYL-17): stored once per request id, then told to the
 * owner through the shared mail job lifecycle (`mailQueue`). Provider calls
 * happen outside any transaction; only the current lease holder settles.
 */
export function leagueRequestOperations({
  database,
  eventSink,
}: {
  readonly database: Database;
  readonly eventSink: DatabaseEventSink | undefined;
}) {
  return {
    /**
     * Stores a validated request with its notice queued now. A request id
     * already stored is left as it is, so sending the form again after a
     * lost answer stores and tells the owner once.
     */
    recordLeagueRequest: (request: LeagueRequest): Promise<void> =>
      instrumented(eventSink, 'recordLeagueRequest', async () => {
        await database.execute(sql`insert into league_requests (
            id, league_name, schools, seasons, style, divisions, needs,
            contact_name, contact_role, contact_email, contact_phone, next_attempt_at
          ) values (
            ${request.requestId}, ${request.leagueName}, ${request.schools},
            ${request.seasons}, ${request.style}, ${request.divisions},
            ${request.needs}, ${request.contactName}, ${request.contactRole},
            ${request.contactEmail}, ${request.contactPhone === '' ? null : request.contactPhone},
            clock_timestamp()
          ) on conflict (id) do nothing`);
      }),
    claimLeagueRequestNotices: (
      input: MailJobClaimInput,
    ): Promise<readonly LeagueRequestNoticeClaim[]> =>
      instrumented(eventSink, 'claimLeagueRequestNotices', async () =>
        (await noticeQueue.claimDue(database, input, sql`id, attempts`)).map(
          ({ row, token }) => ({ ...claimRow.parse(row), token }),
        ),
      ),
    readLeagueRequestNotice: (id: string): Promise<LeagueRequestNotice> =>
      instrumented(eventSink, 'readLeagueRequestNotice', async () => {
        const [row] = await rowsOf<unknown>(
          database,
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
            eligible: sql`${leagueRequests.state} <> 'leased'`,
          },
          batch,
        ),
      ),
  };
}
