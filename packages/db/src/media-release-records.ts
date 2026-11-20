import {
  mediaReleaseWording,
  type MediaReleaseRecord,
  type ReleaseRequest,
} from '@daisy/protocol/media-release';
import { sql } from 'drizzle-orm';
import { divisionAgeBand, divisionOfBandSql } from './ladder-division-band';
import { isDebatingSeatSql } from './seat-columns';
import { scopeTransaction } from './tenant-scope';
import type { MediaReleaseMailKind } from './media-release-mail';
import type { Tx } from './tx';
import { run, query as queryRows } from './raw-rows';
import { z } from 'zod';

export const iso = (value: unknown): string =>
  new Date(value as string | Date).toISOString();
export const isoOrNull = (value: unknown): string | null =>
  value === null || value === undefined ? null : iso(value);

export type ReleaseRow = {
  id: string;
  user_id: string;
  scope: MediaReleaseRecord['scope'];
  source: 'parent' | 'club';
  signer_name: string | null;
  signer_relation: 'parent' | 'legal_guardian' | null;
  signer_email: string | null;
  wording_version: string;
  signed_at: Date | string;
  withdrawn_at: Date | string | null;
  withdrawn_by: MediaReleaseRecord['withdrawnBy'];
  organization_id: string | null;
  organization_name: string | null;
  attested_by_user_id: string | null;
  attester_name: string | null;
  attester_role: string | null;
};

export const releaseOf = (row: ReleaseRow): MediaReleaseRecord => ({
  id: row.id,
  subjectUserId: row.user_id,
  scope: row.scope,
  attestation:
    row.source === 'parent'
      ? {
          kind: 'parent',
          name: row.signer_name ?? '',
          relation: row.signer_relation ?? 'parent',
          email: row.signer_email ?? '',
        }
      : {
          kind: 'club',
          organizationId: row.organization_id ?? '',
          organizationName: row.organization_name ?? '',
          attestedByUserId: row.attested_by_user_id ?? '',
          name: row.attester_name ?? '',
          role: row.attester_role ?? '',
        },
  wordingVersion: row.wording_version,
  signedAt: iso(row.signed_at),
  withdrawnAt: isoOrNull(row.withdrawn_at),
  withdrawnBy: row.withdrawn_by,
});

type RequestRow = {
  id: string;
  user_id: string;
  recipient_email: string;
  requested_at: Date | string;
  expires_at: Date | string;
  outcome: ReleaseRequest['outcome'];
  resolved_at: Date | string | null;
  sends: number;
  last_sent_at: Date | string | null;
};

const requestOf = (row: RequestRow): ReleaseRequest => ({
  id: row.id,
  subjectUserId: row.user_id,
  recipientEmail: row.recipient_email,
  requestedAt: iso(row.requested_at),
  expiresAt: iso(row.expires_at),
  outcome: row.outcome,
  resolvedAt: isoOrNull(row.resolved_at),
  sends: Number(row.sends),
  lastSentAt: isoOrNull(row.last_sent_at),
});

/**
 * A minor's releases, each with its club attestation when it has one. The
 * attestation is the club's row: it is read under the minor's subject scope.
 * `lock` takes the minor's release rows for the rest of the transaction.
 */
export async function readReleasesOf(
  tx: Tx,
  userIds: readonly string[],
  lock: boolean,
): Promise<readonly MediaReleaseRecord[]> {
  const found: MediaReleaseRecord[] = [];
  for (const userId of userIds) {
    await scopeTransaction(tx, { subjectUserId: userId });
    const read = await queryRows(
      tx,
      z.object({
        id: z.string(),
        user_id: z.string(),
        scope: z.enum(['publish', 'paid_ads']),
        source: z.enum(['parent', 'club']),
        signer_name: z.string().nullable(),
        signer_relation: z.enum(['parent', 'legal_guardian']).nullable(),
        signer_email: z.string().nullable(),
        wording_version: z.string(),
        signed_at: z.union([z.string(), z.date()]),
        withdrawn_at: z.union([z.string(), z.date()]).nullable(),
        withdrawn_by: z.enum(['parent', 'club', 'erasure']).nullable(),
        organization_id: z.string().nullable(),
        organization_name: z.string().nullable(),
        attested_by_user_id: z.string().nullable(),
        attester_name: z.string().nullable(),
        attester_role: z.string().nullable(),
      }),
      sql`select r.id, r.user_id, r.scope, r.source, r.signer_name,
          r.signer_relation, r.signer_email, r.wording_version, r.signed_at,
          r.withdrawn_at, r.withdrawn_by, a.organization_id,
          o.name as organization_name, a.attested_by_user_id, a.attester_name,
          a.attester_role
        from media_releases r
        left join media_release_club_attestations a on a.release_id = r.id
        left join organizations o on o.id = a.organization_id
        where r.user_id = ${userId}
        order by r.signed_at, r.id
        ${lock ? sql`for update of r` : sql``}`,
    );
    found.push(...read.map(releaseOf));
  }
  return found;
}

/** A minor's recent requests, newest first. */
export async function readRequestsOf(
  tx: Tx,
  userId: string,
  lock: boolean,
): Promise<readonly ReleaseRequest[]> {
  const read = await queryRows(
    tx,
    z.object({
      id: z.string(),
      user_id: z.string(),
      recipient_email: z.string(),
      requested_at: z.union([z.string(), z.date()]),
      expires_at: z.union([z.string(), z.date()]),
      outcome: z
        .enum([
          'signed',
          'declined',
          'not_me',
          'cancelled',
          'superseded',
          'expired',
          'stopped',
        ])
        .nullable(),
      resolved_at: z.union([z.string(), z.date()]).nullable(),
      sends: z.number(),
      last_sent_at: z.union([z.string(), z.date()]).nullable(),
    }),
    sql`select id, user_id, recipient_email, requested_at, expires_at, outcome,
        resolved_at, sends, last_sent_at
      from media_release_requests where user_id = ${userId}
      order by requested_at desc, id desc limit 20
      ${lock ? sql`for update` : sql``}`,
  );
  return read.map(requestOf);
}

/** A member's ladder division, decided as every ranked command decides it. */
export async function readDivisionOf(
  tx: Tx,
  userId: string,
): Promise<'open' | 'youth' | null> {
  const [row] = await queryRows(
    tx,
    z.object({ division: z.enum(['open', 'youth']).nullable() }),
    sql`select ${divisionOfBandSql(divisionAgeBand())} as division
      from account_age where account_age.user_id = ${userId}`,
  );
  return row?.division ?? null;
}

/** Ends every public Youth Recording of a Round this minor debated (ADR 0151). */
export async function endPublicationsOf(
  tx: Tx,
  userId: string,
): Promise<number> {
  const ended = await queryRows(
    tx,
    z.object({ round_id: z.string() }),
    sql`update youth_round_publications p set ended_at = clock_timestamp()
      where p.ended_at is null and exists (
        select 1 from round_participants rp
        join actors a on a.id = rp.actor_id
        where rp.round_id = p.round_id and a.user_id = ${userId}
          and ${isDebatingSeatSql(sql`rp.seat_kind`)})
      returning p.round_id`,
  );
  return ended.length;
}

/** Writes one release scope; the unique index holds one active per minor per scope. */
export async function insertMediaRelease(
  tx: Tx,
  input: {
    readonly id: string;
    readonly userId: string;
    readonly scope: MediaReleaseRecord['scope'];
    readonly parent: {
      readonly requestId: string;
      readonly name: string;
      readonly relation: string;
      readonly email: string;
    } | null;
    readonly now: Date;
  },
) {
  await run(
    tx,
    sql`insert into media_releases (id, user_id, scope, source, request_id,
        signer_name, signer_relation, signer_email, wording_version, signed_at)
      values (${input.id}, ${input.userId}, ${input.scope},
        ${input.parent === null ? 'club' : 'parent'},
        ${input.parent?.requestId ?? null}, ${input.parent?.name ?? null},
        ${input.parent?.relation ?? null}, ${input.parent?.email ?? null},
        ${mediaReleaseWording.version}, ${input.now.toISOString()})`,
  );
}

export async function queueMediaReleaseMail(
  tx: Tx,
  input: {
    readonly id: string;
    readonly kind: MediaReleaseMailKind;
    readonly requestId: string;
    readonly at: SqlInstant;
  },
) {
  await run(
    tx,
    sql`insert into media_release_mails (id, kind, request_id, next_attempt_at)
      values (${input.id}, ${input.kind}, ${input.requestId}, ${input.at})`,
  );
}

export type SqlInstant = ReturnType<typeof sql>;
export const nowSql = sql`clock_timestamp()`;
