import {
  reuseLicensingWordings,
  type MediaReleaseRecord,
  type ReleaseRequest,
} from '@daisy/protocol/media-release';
import { sql } from 'drizzle-orm';
import { divisionAgeBand, divisionOfBandSql } from './ladder-division-band';
import { scopeTransaction } from './tenant-scope';
import type { BoundedTransactionContext } from './transaction-context';
import type { MediaReleaseMailKind } from './media-release-mail';

/**
 * Media release records as the commands read and write them (ADR 0151): a
 * minor's releases (with a club's attestation, read under the minor's subject
 * scope), their requests, their ladder division, and the writes every command
 * shares.
 */
type Tx = BoundedTransactionContext;

export const iso = (value: unknown): string =>
  new Date(value as string | Date).toISOString();
export const isoOrNull = (value: unknown): string | null =>
  value === null || value === undefined ? null : iso(value);

export const rows = async <Row>(
  tx: Pick<Tx, 'execute'>,
  query: ReturnType<typeof sql>,
) => (await tx.execute(query)) as unknown as Row[];

type ReleaseRow = {
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

const releaseOf = (row: ReleaseRow): MediaReleaseRecord => ({
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
  tx: Pick<Tx, 'execute'>,
  userIds: readonly string[],
  lock: boolean,
): Promise<readonly MediaReleaseRecord[]> {
  const found: MediaReleaseRecord[] = [];
  for (const userId of userIds) {
    await scopeTransaction(tx, { subjectUserId: userId });
    const read = await rows<ReleaseRow>(
      tx,
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
  tx: Pick<Tx, 'execute'>,
  userId: string,
  lock: boolean,
): Promise<readonly ReleaseRequest[]> {
  const read = await rows<RequestRow>(
    tx,
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
  tx: Pick<Tx, 'execute'>,
  userId: string,
): Promise<'open' | 'youth' | null> {
  const [row] = await rows<{ division: 'open' | 'youth' | null }>(
    tx,
    sql`select ${divisionOfBandSql(divisionAgeBand())} as division
      from account_age where account_age.user_id = ${userId}`,
  );
  return row?.division ?? null;
}

/**
 * Retire older publishing-only consent when authenticated replacement consent
 * succeeds. Each caller already holds the minor's account lock. Paid-ad
 * consent is separate and is recorded again only when explicitly selected.
 */
export const supersedeOldRelease = (tx: Tx, userId: string, now: Date) =>
  tx.execute(sql`update media_releases r
    set withdrawn_at = ${now.toISOString()}, withdrawn_by = 'superseded'
    where r.user_id = ${userId} and r.withdrawn_at is null
      and exists (select 1 from media_releases old
        where old.user_id = r.user_id and old.scope = 'publish'
          and old.withdrawn_at is null
          and old.wording_version not in (${sql.join(
            reuseLicensingWordings.map((version) => sql`${version}`),
            sql`, `,
          )}))`);

/** Writes one release scope; the unique index holds one active per minor per scope. */
export async function insertMediaRelease(
  tx: Tx,
  input: {
    readonly id: string;
    readonly userId: string;
    readonly scope: MediaReleaseRecord['scope'];
    readonly wordingVersion: string;
    readonly parent: {
      readonly requestId: string;
      readonly name: string;
      readonly relation: string;
      readonly email: string;
    } | null;
    readonly now: Date;
  },
) {
  await tx.execute(
    sql`insert into media_releases (id, user_id, scope, source, request_id,
        signer_name, signer_relation, signer_email, wording_version, signed_at)
      values (${input.id}, ${input.userId}, ${input.scope},
        ${input.parent === null ? 'club' : 'parent'},
        ${input.parent?.requestId ?? null}, ${input.parent?.name ?? null},
        ${input.parent?.relation ?? null}, ${input.parent?.email ?? null},
        ${input.wordingVersion}, ${input.now.toISOString()})`,
  );
}

export async function queueMediaReleaseMail(
  tx: Pick<Tx, 'execute'>,
  input: {
    readonly id: string;
    readonly kind: MediaReleaseMailKind;
    readonly requestId: string;
    readonly at: SqlInstant;
  },
) {
  await tx.execute(
    sql`insert into media_release_mails (id, kind, request_id, next_attempt_at)
      values (${input.id}, ${input.kind}, ${input.requestId}, ${input.at})`,
  );
}

export type SqlInstant = ReturnType<typeof sql>;
export const nowSql = sql`clock_timestamp()`;
