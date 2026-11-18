import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import {
  decideAnswer,
  decideAsk,
  decidePaidAdsChange,
  decideResend,
  decideSignature,
  decideWithdrawal,
  isReleaseRequestOpen,
  mediaReleasePolicy,
  mediaReleaseWording,
  parentHeldOf,
  releaseLinkVerdict,
  releaseRequestExpiry,
  releaseStandingOf,
  type AskRefusal,
  type MediaReleaseRecord,
  type ParentHeld,
  type ReleaseLinkPurpose,
  type ReleaseLinkVerdict,
  type ReleaseRequest,
  type ReleaseStanding,
  type ResendRefusal,
} from '@daisy/protocol/media-release';
import { sql } from 'drizzle-orm';
import type { BoundedTransaction } from './bounded-transaction';
import { readDatabaseTime } from './database-clock';
import { divisionAgeBand, divisionOfBandSql } from './ladder-division-band';
import { oweNotifications } from './notifications/owe';
import { isDebatingSeatSql } from './seat-columns';
import { scopeTransaction } from './tenant-scope';
import type { BoundedTransactionContext } from './transaction-context';
import { readLinkedAdultUserIds } from './youth-recording-people';
import type { MediaReleaseMailKind } from './media-release-mail';

type Tx = BoundedTransactionContext;

const iso = (value: unknown): string =>
  new Date(value as string | Date).toISOString();
const isoOrNull = (value: unknown): string | null =>
  value === null || value === undefined ? null : iso(value);

const rows = async <Row>(
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

/** Ends every public Youth Recording of a Round this minor debated (ADR 0151). */
export async function endPublicationsOf(
  tx: Pick<Tx, 'execute'>,
  userId: string,
): Promise<number> {
  const ended = await rows<{ round_id: string }>(
    tx,
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
async function insertRelease(
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
  await tx.execute(
    sql`insert into media_releases (id, user_id, scope, source, request_id,
        signer_name, signer_relation, signer_email, wording_version, signed_at)
      values (${input.id}, ${input.userId}, ${input.scope},
        ${input.parent === null ? 'club' : 'parent'},
        ${input.parent?.requestId ?? null}, ${input.parent?.name ?? null},
        ${input.parent?.relation ?? null}, ${input.parent?.email ?? null},
        ${mediaReleaseWording.version}, ${input.now.toISOString()})`,
  );
}
export { insertRelease as insertMediaRelease };

async function queueMail(
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
export { queueMail as queueMediaReleaseMail };

type SqlInstant = ReturnType<typeof sql>;
const nowSql = sql`clock_timestamp()`;

/** What a minor's Settings section reads. */
export type MinorReleaseRead = {
  readonly division: 'open' | 'youth' | null;
  readonly standing: ReleaseStanding;
  /** The clubs (school or family) the minor is an active member of. */
  readonly clubs: readonly {
    readonly id: string;
    readonly name: string;
    /** When the minor last asked this club, if in the last 7 days. */
    readonly askedAt: string | null;
  }[];
  readonly privateYouthRounds: number;
};

/** A parent's link, as the sign and manage pages read it. */
export type ParentLinkRead =
  | { readonly kind: 'unknown' }
  | {
      readonly kind: 'link';
      readonly verdict: ReleaseLinkVerdict;
      readonly request: ReleaseRequest;
      readonly minor: { readonly username: string | null };
      readonly standing: ReleaseStanding;
      readonly held: ParentHeld;
    };

export type ParentAnswer =
  | { readonly kind: 'done'; readonly requestId: string }
  | { readonly kind: 'refused'; readonly reason: string };

/** A token digest is `<purpose>:<64 hex>`; anything else is unknown. */
const digestPattern = /^(sign|manage):[0-9a-f]{64}$/u;

/**
 * Media release commands (ADR 0151) for the minor and the parent. Each loads
 * its facts under row locks, asks the pure rule in `@daisy/protocol`, and
 * writes what it decided with its notices and mail in the same transaction.
 */
export function createMediaReleases(input: {
  readonly run: BoundedTransaction;
  readonly nextId: () => string;
}) {
  const { run, nextId } = input;

  async function minorFacts(tx: Tx, userId: string, now: Date) {
    // The minor's account row orders every command about them.
    await tx.execute(sql`select 1 from users where id = ${userId} for update`);
    const releases = await readReleasesOf(tx, [userId], true);
    const requests = await readRequestsOf(tx, userId, true);
    return {
      releases,
      requests,
      standing: releaseStandingOf({
        subjectUserId: userId,
        releases,
        requests,
        nowMs: now.getTime(),
      }),
    };
  }

  /** The link by its digest, its request, and the minor's locked facts. */
  async function linkFacts(
    tx: Tx,
    digest: string,
    purpose: ReleaseLinkPurpose,
  ) {
    if (!digestPattern.test(digest)) return null;
    const [link] = await rows<{
      id: string;
      purpose: ReleaseLinkPurpose;
      request_id: string;
      expires_at: Date | string;
      consumed_at: Date | string | null;
    }>(
      tx,
      sql`select id, purpose, request_id, expires_at, consumed_at
        from media_release_links where token_digest = ${digest} for update`,
    );
    if (link === undefined) return null;
    const [owner] = await rows<{ user_id: string }>(
      tx,
      sql`select user_id from media_release_requests where id = ${link.request_id}`,
    );
    if (owner === undefined) return null;
    const now = await readDatabaseTime(tx);
    const facts = await minorFacts(tx, owner.user_id, now);
    const request = facts.requests.find((r) => r.id === link.request_id);
    if (request === undefined) return null;
    const verdict = releaseLinkVerdict(
      {
        purpose: link.purpose,
        expiresAt: iso(link.expires_at),
        consumedAt: isoOrNull(link.consumed_at),
      },
      purpose,
      now.getTime(),
    );
    return {
      linkId: link.id,
      verdict,
      request,
      now,
      ...facts,
      held: parentHeldOf(facts.releases, owner.user_id, request.recipientEmail),
    };
  }

  const consume = (tx: Tx, linkId: string) =>
    tx.execute(
      sql`update media_release_links set consumed_at = clock_timestamp() where id = ${linkId}`,
    );

  const resolve = (
    tx: Tx,
    requestId: string,
    outcome: NonNullable<ReleaseRequest['outcome']>,
  ) =>
    tx.execute(
      sql`update media_release_requests set outcome = ${outcome},
          resolved_at = clock_timestamp()
        where id = ${requestId} and outcome is null`,
    );

  /** The minor and their school staff: who hears that a release was withdrawn. */
  async function withdrawnRecipients(tx: Tx, userId: string) {
    const staff = await readLinkedAdultUserIds(tx, userId);
    return [userId, ...staff].map((recipient) => ({
      userId: recipient,
      about: null,
    }));
  }

  return {
    /** The minor's Settings section. */
    readMinorRelease: (userId: string): Promise<MinorReleaseRead> =>
      run(async (tx) => {
        const now = await readDatabaseTime(tx);
        const releases = await readReleasesOf(tx, [userId], false);
        const requests = await readRequestsOf(tx, userId, false);
        await scopeTransaction(tx, { subjectUserId: userId });
        const clubs = await rows<{
          id: string;
          name: string;
          asked_at: Date | string | null;
        }>(
          tx,
          sql`select o.id, o.name,
              (select max(k.asked_at) from media_release_club_asks k
                where k.organization_id = o.id and k.user_id = ${userId}
                  and k.asked_at > clock_timestamp() - interval '7 days') as asked_at
            from memberships m join organizations o on o.id = m.organization_id
            where m.user_id = ${userId} and m.status = 'active'
              and o.kind in ('school', 'family') and o.closed_at is null
            order by o.name, o.id`,
        );
        const [count] = await rows<{ n: number }>(
          tx,
          sql`select count(*)::int as n from rounds r
            join round_participants rp on rp.round_id = r.id
            join actors a on a.id = rp.actor_id
            left join youth_round_publications p on p.round_id = r.id and p.ended_at is null
            where a.user_id = ${userId} and ${isDebatingSeatSql(sql`rp.seat_kind`)}
              and public.daisy_round_participant_is_current(rp.id)
              and r.ladder_division = 'youth' and p.round_id is null`,
        );
        return {
          division: await readDivisionOf(tx, userId),
          standing: releaseStandingOf({
            subjectUserId: userId,
            releases,
            requests,
            nowMs: now.getTime(),
          }),
          clubs: clubs.map((club) => ({
            id: club.id,
            name: club.name,
            askedAt: isoOrNull(club.asked_at),
          })),
          privateYouthRounds: count?.n ?? 0,
        };
      }),

    /**
     * The minor asks a parent's address to sign. `recipientStopped` is the
     * web's keyed-hash lookup, read inside this transaction.
     */
    ask: (command: {
      readonly userId: string;
      readonly email: string;
      readonly recipientHash: string;
    }): Promise<
      | { readonly kind: 'asked'; readonly requestId: string }
      | { readonly kind: 'refused'; readonly reason: AskRefusal }
    > =>
      run(async (tx) => {
        const now = await readDatabaseTime(tx);
        const facts = await minorFacts(tx, command.userId, now);
        const [stopped] = await rows<{ n: number }>(
          tx,
          sql`select count(*)::int as n from media_release_stops
            where recipient_hash = ${command.recipientHash}`,
        );
        const asksToday = facts.requests.filter(
          (r) =>
            now.getTime() - Date.parse(r.requestedAt) < 24 * 60 * 60 * 1000,
        ).length;
        const decision = decideAsk(
          {
            youth: (await readDivisionOf(tx, command.userId)) === 'youth',
            standing: facts.standing,
            recipientStopped: (stopped?.n ?? 0) > 0,
            asksToday,
          },
          command.email,
        );
        if (!decision.ok) return { kind: 'refused', reason: decision.refusal };
        // An earlier request still unresolved ends: replaced, or lapsed.
        for (const earlier of facts.requests.filter((r) => r.outcome === null))
          await resolve(
            tx,
            earlier.id,
            isReleaseRequestOpen(earlier, now.getTime())
              ? 'cancelled'
              : 'expired',
          );
        const requestId = nextId();
        await tx.execute(
          sql`insert into media_release_requests (id, user_id, recipient_email,
              requested_at, expires_at, sends, last_sent_at)
            values (${requestId}, ${command.userId}, ${decision.recipientEmail},
              ${now.toISOString()}, ${releaseRequestExpiry(now.getTime())}, 1,
              ${now.toISOString()})`,
        );
        await queueMail(tx, {
          id: nextId(),
          kind: 'request',
          requestId,
          at: nowSql,
        });
        await queueMail(tx, {
          id: nextId(),
          kind: 'reminder',
          requestId,
          at: sql`${now.toISOString()}::timestamptz + ${mediaReleasePolicy.reminderAfterMs} * interval '1 millisecond'`,
        });
        await oweNotifications(tx, {
          kind: 'media_release_requested',
          subject: { media_release_request_id: requestId },
          recipients: [{ userId: command.userId, about: null }],
          at: now.toISOString(),
          nextId,
        });
        return { kind: 'asked', requestId };
      }),

    /** "Send again": one more email for the open request. */
    resend: (
      userId: string,
    ): Promise<
      | { readonly kind: 'sent' }
      | { readonly kind: 'refused'; readonly reason: ResendRefusal }
    > =>
      run(async (tx) => {
        const now = await readDatabaseTime(tx);
        const facts = await minorFacts(tx, userId, now);
        if (facts.standing.kind !== 'waiting')
          return { kind: 'refused', reason: 'not_open' };
        const request = facts.standing.request;
        const decision = decideResend(request, now.getTime());
        if (!decision.ok) return { kind: 'refused', reason: decision.refusal };
        await tx.execute(
          sql`update media_release_requests set sends = sends + 1,
              last_sent_at = ${now.toISOString()} where id = ${request.id}`,
        );
        await queueMail(tx, {
          id: nextId(),
          kind: 'request',
          requestId: request.id,
          at: nowSql,
        });
        return { kind: 'sent' };
      }),

    /** "Cancel request": the open request ends and its links die. */
    cancel: (
      userId: string,
    ): Promise<{ readonly kind: 'cancelled' | 'none' }> =>
      run(async (tx) => {
        const now = await readDatabaseTime(tx);
        const facts = await minorFacts(tx, userId, now);
        if (facts.standing.kind !== 'waiting') return { kind: 'none' };
        await resolve(tx, facts.standing.request.id, 'cancelled');
        return { kind: 'cancelled' };
      }),

    /** The sign or manage page: what this link may do, read without changing it. */
    readParentLink: (
      digest: string,
      purpose: ReleaseLinkPurpose,
    ): Promise<ParentLinkRead> =>
      run(async (tx) => {
        const facts = await linkFacts(tx, digest, purpose);
        if (facts === null) return { kind: 'unknown' };
        const [minor] = await rows<{ username: string | null }>(
          tx,
          sql`select username from users where id = ${facts.request.subjectUserId}
            and deleted_at is null`,
        );
        return {
          kind: 'link',
          verdict: facts.verdict,
          request: facts.request,
          minor: { username: minor?.username ?? null },
          standing: facts.standing,
          held: facts.held,
        };
      }),

    /** The parent signs: the release scopes, the request signed, the copy mailed. */
    sign: (digest: string, form: unknown): Promise<ParentAnswer> =>
      run(async (tx) => {
        const facts = await linkFacts(tx, digest, 'sign');
        if (facts === null) return { kind: 'refused', reason: 'unknown' };
        const decision = decideSignature(
          {
            link: facts.verdict,
            request: facts.request,
            standing: facts.standing,
            nowMs: facts.now.getTime(),
          },
          form,
        );
        if (!decision.ok) return { kind: 'refused', reason: decision.refusal };
        const userId = facts.request.subjectUserId;
        const ids = decision.scopes.map(() => nextId());
        for (const [index, scope] of decision.scopes.entries())
          await insertRelease(tx, {
            id: ids[index]!,
            userId,
            scope,
            parent: {
              requestId: facts.request.id,
              name: decision.signature.name,
              relation: decision.signature.relation,
              email: decision.signature.email,
            },
            now: facts.now,
          });
        await consume(tx, facts.linkId);
        await resolve(tx, facts.request.id, 'signed');
        await queueMail(tx, {
          id: nextId(),
          kind: 'copy',
          requestId: facts.request.id,
          at: nowSql,
        });
        await oweNotifications(tx, {
          kind: 'media_release_signed',
          subject: { media_release_id: ids[0]! },
          recipients: [{ userId, about: null }],
          at: facts.now.toISOString(),
          nextId,
        });
        return { kind: 'done', requestId: facts.request.id };
      }),

    /** The parent declines, or says the request is not for them. */
    answer: (
      digest: string,
      outcome: 'declined' | 'not_me',
    ): Promise<ParentAnswer> =>
      run(async (tx) => {
        const facts = await linkFacts(tx, digest, 'sign');
        if (facts === null) return { kind: 'refused', reason: 'unknown' };
        const decision = decideAnswer({
          link: facts.verdict,
          request: facts.request,
          nowMs: facts.now.getTime(),
        });
        if (!decision.ok) return { kind: 'refused', reason: decision.refusal };
        await consume(tx, facts.linkId);
        await resolve(tx, facts.request.id, outcome);
        // "Declining tells Sam you said no"; a wrong address tells them nothing new.
        if (outcome === 'declined')
          await oweNotifications(tx, {
            kind: 'media_release_declined',
            subject: { media_release_request_id: facts.request.id },
            recipients: [{ userId: facts.request.subjectUserId, about: null }],
            at: facts.now.toISOString(),
            nextId,
          });
        return { kind: 'done', requestId: facts.request.id };
      }),

    /**
     * The parent withdraws, through a manage link: the scopes end, every
     * public Youth Recording of the minor's Rounds ends, and the minor and
     * their coaches are told.
     */
    withdraw: (digest: string, form: unknown): Promise<ParentAnswer> =>
      run(async (tx) => {
        const facts = await linkFacts(tx, digest, 'manage');
        if (facts === null) return { kind: 'refused', reason: 'unknown' };
        if (facts.verdict !== 'usable')
          return { kind: 'refused', reason: facts.verdict };
        const decision = decideWithdrawal(facts.held, form);
        if (!decision.ok) return { kind: 'refused', reason: decision.refusal };
        await tx.execute(
          sql`update media_releases set withdrawn_at = clock_timestamp(),
              withdrawn_by = 'parent', withdrawal_note = ${decision.note}
            where id in ${sql`(${sql.join(
              decision.withdraw.map((id) => sql`${id}`),
              sql`, `,
            )})`} and withdrawn_at is null`,
        );
        await consume(tx, facts.linkId);
        const userId = facts.request.subjectUserId;
        const whole =
          facts.held.publish !== null &&
          decision.withdraw.includes(facts.held.publish.id);
        if (whole) {
          await endPublicationsOf(tx, userId);
          await oweNotifications(tx, {
            kind: 'media_release_withdrawn',
            subject: { media_release_id: facts.held.publish!.id },
            recipients: await withdrawnRecipients(tx, userId),
            at: facts.now.toISOString(),
            nextId,
          });
        } else {
          // Publishing stays: a fresh copy carries a new manage link.
          await queueMail(tx, {
            id: nextId(),
            kind: 'copy',
            requestId: facts.request.id,
            at: nowSql,
          });
        }
        return { kind: 'done', requestId: facts.request.id };
      }),

    /** The parent changes the paid-ads choice through a manage link. */
    changePaidAds: (digest: string, allow: boolean): Promise<ParentAnswer> =>
      run(async (tx) => {
        const facts = await linkFacts(tx, digest, 'manage');
        if (facts === null) return { kind: 'refused', reason: 'unknown' };
        if (facts.verdict !== 'usable')
          return { kind: 'refused', reason: facts.verdict };
        const decision = decidePaidAdsChange(facts.held, allow);
        if (!decision.ok) return { kind: 'refused', reason: decision.refusal };
        const publish = facts.held.publish!;
        if (decision.change === 'grant') {
          const signer = publish.attestation;
          if (signer.kind !== 'parent') throw createAppError('INVARIANT');
          await insertRelease(tx, {
            id: nextId(),
            userId: facts.request.subjectUserId,
            scope: 'paid_ads',
            parent: {
              requestId: facts.request.id,
              name: signer.name,
              relation: signer.relation,
              email: signer.email,
            },
            now: facts.now,
          });
        } else {
          await tx.execute(
            sql`update media_releases set withdrawn_at = clock_timestamp(),
                withdrawn_by = 'parent' where id = ${decision.releaseId}`,
          );
        }
        await consume(tx, facts.linkId);
        await queueMail(tx, {
          id: nextId(),
          kind: 'copy',
          requestId: facts.request.id,
          at: nowSql,
        });
        return { kind: 'done', requestId: facts.request.id };
      }),

    /**
     * A fresh manage link, mailed to the address that signed: from a used sign
     * link, or from /release/manage by address. The answer never says whether
     * any release was found.
     */
    mailManageLink: (
      by:
        | { readonly kind: 'link'; readonly digest: string }
        | { readonly kind: 'email'; readonly email: string },
    ): Promise<void> =>
      run(async (tx) => {
        const found =
          by.kind === 'link'
            ? digestPattern.test(by.digest)
              ? await rows<{ request_id: string }>(
                  tx,
                  sql`select l.request_id from media_release_links l
                    join media_release_requests q on q.id = l.request_id
                    where l.token_digest = ${by.digest} and q.outcome = 'signed'`,
                )
              : []
            : await rows<{ request_id: string }>(
                tx,
                sql`select distinct r.request_id from media_releases r
                  where r.signer_email = ${by.email} and r.source = 'parent'
                    and r.withdrawn_at is null and r.request_id is not null
                  limit 10`,
              );
        for (const { request_id: requestId } of found) {
          // At most one manage-link mail an hour per request.
          const [recent] = await rows<{ n: number }>(
            tx,
            sql`select count(*)::int as n from media_release_mails
              where request_id = ${requestId} and kind = 'manage_link'
                and created_at > clock_timestamp() - interval '1 hour'`,
          );
          if ((recent?.n ?? 0) === 0)
            await queueMail(tx, {
              id: nextId(),
              kind: 'manage_link',
              requestId,
              at: nowSql,
            });
        }
      }),

    /** "Don't send me release requests": the address's keyed hash is kept. */
    stopRequests: (recipientHash: string): Promise<void> =>
      run(async (tx) => {
        await tx.execute(
          sql`insert into media_release_stops (recipient_hash) values (${recipientHash})
            on conflict do nothing`,
        );
      }),

    /**
     * The active publish releases of these minors, as recording reads them
     * (ADR 0150's named input).
     */
    readActivePublishReleases: (
      userIds: readonly string[],
    ): Promise<readonly MediaReleaseRecord[]> =>
      run(async (tx) => {
        const valid = userIds.filter((id) => idSchema.safeParse(id).success);
        if (valid.length === 0) return [];
        const read = await rows<ReleaseRow>(
          tx,
          sql`select r.id, r.user_id, r.scope, r.source, r.signer_name,
              r.signer_relation, r.signer_email, r.wording_version, r.signed_at,
              r.withdrawn_at, r.withdrawn_by, null as organization_id,
              null as organization_name, null as attested_by_user_id,
              null as attester_name, null as attester_role
            from media_releases r
            where r.user_id in ${sql`(${sql.join(
              valid.map((id) => sql`${id}`),
              sql`, `,
            )})`}
              and r.withdrawn_at is null and r.scope = 'publish'`,
        );
        return read.map(releaseOf);
      }),
  };
}
