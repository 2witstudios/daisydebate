import {
  mediaReleasePolicy,
  type ReleaseLinkPurpose,
} from '@daisy/protocol/media-release';
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
  mediaReleaseMails,
  mediaReleases,
  mediaReleaseRequests,
  type mediaReleaseMailErrorCodes,
  type mediaReleaseMailKinds,
} from './schema/media-releases';

export type MediaReleaseMailKind = (typeof mediaReleaseMailKinds)[number];
export type MediaReleaseMailOutcome = MailJobOutcome<
  (typeof mediaReleaseMailErrorCodes)[number]
>;

const queue = mailQueue(mediaReleaseMails, { unknownAfterLapse: sql`false` });

const claimRow = z.object({
  id: z.string(),
  kind: z.enum(['request', 'reminder', 'copy', 'manage_link']),
  attempts: z.coerce.number(),
});
export type MediaReleaseMailClaim = z.infer<typeof claimRow> & {
  readonly token: string;
};

/** Which link a mail carries: a request and its reminder sign; the rest manage. */
export const releaseLinkPurposeOf = (
  kind: MediaReleaseMailKind,
): ReleaseLinkPurpose =>
  kind === 'request' || kind === 'reminder' ? 'sign' : 'manage';

/** What a mail says, read when it is sent; its link is stored with it. */
export type PreparedReleaseMail =
  | { readonly kind: 'not-owed' }
  | {
      readonly kind: 'owed';
      readonly mail: MediaReleaseMailKind;
      readonly recipientEmail: string;
      readonly minorUsername: string | null;
      /** When the link it carries stops working. */
      readonly linkExpiresAt: string;
      /** The copy's record: what was signed, by whom, when. */
      readonly signed: {
        readonly name: string;
        readonly relation: 'parent' | 'legal_guardian';
        readonly signedAt: string;
        readonly paidAds: boolean;
        readonly wordingVersion: string;
      } | null;
    };

const iso = (value: unknown) => new Date(value as string | Date).toISOString();

/**
 * The parent's mail (ADR 0151): queued in the deciding transaction, sent by
 * the web mail worker. The link is minted at send time and stored here, in
 * the same transaction that checks the mail is still owed, before the
 * provider is called; a retried send stores another link and never kills one
 * already delivered.
 */
export function mediaReleaseMailOperations({
  database,
  eventSink,
}: {
  readonly database: BunSQLDatabase;
  readonly eventSink?: DatabaseEventSink | undefined;
}) {
  return {
    claimMediaReleaseMails: (
      input: MailJobClaimInput,
    ): Promise<readonly MediaReleaseMailClaim[]> =>
      instrumented(eventSink, 'claimMediaReleaseMails', async () =>
        (await queue.claimDue(database, input, sql`id, kind, attempts`)).map(
          ({ row, token }) => ({ ...claimRow.parse(row), token }),
        ),
      ),

    prepareMediaReleaseMail: (input: {
      readonly mailId: string;
      readonly linkId: string;
      /** `<purpose>:<sha3-256 hex>` of the token this mail will carry. */
      readonly tokenDigest: string;
    }): Promise<PreparedReleaseMail> =>
      instrumented(eventSink, 'prepareMediaReleaseMail', () =>
        database.transaction(async (tx) => {
          const [mail] = await rowsOf<{
            kind: MediaReleaseMailKind;
            request_id: string;
            recipient_email: string;
            expires_at: Date | string;
            outcome: string | null;
            username: string | null;
          }>(
            tx,
            sql`select m.kind, m.request_id, q.recipient_email, q.expires_at,
                q.outcome, u.username
              from media_release_mails m
              join media_release_requests q on q.id = m.request_id
              left join users u on u.id = q.user_id and u.deleted_at is null
              where m.id = ${input.mailId} for update of q`,
          );
          if (mail === undefined || mail.username === null)
            return { kind: 'not-owed' };
          const purpose = releaseLinkPurposeOf(mail.kind);
          if (!input.tokenDigest.startsWith(`${purpose}:`))
            return { kind: 'not-owed' };
          const [now] = await rowsOf<{ now: Date | string }>(
            tx,
            sql`select clock_timestamp() as now`,
          );
          const nowMs = Date.parse(iso(now!.now));
          let linkExpiresAt: string;
          let signed: Extract<PreparedReleaseMail, { kind: 'owed' }>['signed'] =
            null;
          if (purpose === 'sign') {
            // A request and its reminder are owed only while it is open.
            if (
              mail.outcome !== null ||
              Date.parse(iso(mail.expires_at)) <= nowMs
            )
              return { kind: 'not-owed' };
            linkExpiresAt = iso(mail.expires_at);
          } else {
            const held = await rowsOf<{
              scope: 'publish' | 'paid_ads';
              signer_name: string;
              signer_relation: 'parent' | 'legal_guardian';
              signed_at: Date | string;
              wording_version: string;
            }>(
              tx,
              sql`select scope, signer_name, signer_relation, signed_at, wording_version
                from media_releases
                where request_id = ${mail.request_id} and source = 'parent'
                  and signer_email = ${mail.recipient_email} and withdrawn_at is null`,
            );
            const publish = held.find((row) => row.scope === 'publish');
            if (publish === undefined) return { kind: 'not-owed' };
            linkExpiresAt = new Date(
              nowMs + mediaReleasePolicy.manageLinkTtlMs,
            ).toISOString();
            signed = {
              name: publish.signer_name,
              relation: publish.signer_relation,
              signedAt: iso(publish.signed_at),
              paidAds: held.some((row) => row.scope === 'paid_ads'),
              wordingVersion: publish.wording_version,
            };
          }
          await tx.execute(
            sql`insert into media_release_links (id, token_digest, purpose,
                request_id, expires_at)
              values (${input.linkId}, ${input.tokenDigest}, ${purpose},
                ${mail.request_id}, ${linkExpiresAt})
              on conflict (token_digest) do nothing`,
          );
          return {
            kind: 'owed',
            mail: mail.kind,
            recipientEmail: mail.recipient_email,
            minorUsername: mail.username,
            linkExpiresAt,
            signed,
          };
        }),
      ),

    /** False when the lease lapsed and another worker may now hold the mail. */
    settleMediaReleaseMail: (input: {
      readonly id: string;
      readonly token: string;
      readonly outcome: MediaReleaseMailOutcome;
    }): Promise<boolean> =>
      instrumented(eventSink, 'settleMediaReleaseMail', () =>
        queue.settle(database, input),
      ),

    /**
     * Deletes requests that ended, or lapsed unanswered, before the cutoff
     * (the sweep passes 30 days), with their links and mail. A signed request
     * stays while a release it produced is active: the parent's manage links
     * hang from it.
     */
    purgeEndedMediaReleaseRequests: (batch: RetentionBatch): Promise<number> =>
      instrumented(eventSink, 'purgeEndedMediaReleaseRequests', async () => {
        const unheld = sql`not exists (select 1 from ${mediaReleaseMails} m
          where m.request_id = ${mediaReleaseRequests.id} and m.state = 'leased')`;
        const ended = await deleteExpiredBatch(
          database,
          {
            table: mediaReleaseRequests,
            key: mediaReleaseRequests.id,
            at: mediaReleaseRequests.resolvedAt,
            eligible: sql`${unheld} and not exists (select 1 from ${mediaReleases} r
              where r.request_id = ${mediaReleaseRequests.id} and r.withdrawn_at is null)`,
          },
          batch,
        );
        const lapsed = await deleteExpiredBatch(
          database,
          {
            table: mediaReleaseRequests,
            key: mediaReleaseRequests.id,
            at: mediaReleaseRequests.expiresAt,
            eligible: sql`${mediaReleaseRequests.outcome} is null and ${unheld}`,
          },
          batch,
        );
        return ended + lapsed;
      }),

    /** Deletes releases withdrawn before the cutoff (the sweep passes 3 years). */
    purgeWithdrawnMediaReleases: (batch: RetentionBatch): Promise<number> =>
      instrumented(eventSink, 'purgeWithdrawnMediaReleases', () =>
        deleteExpiredBatch(
          database,
          {
            table: mediaReleases,
            key: mediaReleases.id,
            at: mediaReleases.withdrawnAt,
          },
          batch,
        ),
      ),
  };
}
