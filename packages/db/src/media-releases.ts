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
import { oweNotifications } from './notifications/owe';
import { isDebatingSeatSql } from './seat-columns';
import { scopeTransaction } from './tenant-scope';
import { readLinkedAdultUserIds } from './youth-recording-people';

import {
  endPublicationsOf,
  insertMediaRelease,
  isoOrNull,
  iso,
  nowSql,
  queueMediaReleaseMail,
  readDivisionOf,
  readReleasesOf,
  readRequestsOf,
  releaseOf,
  rows,
  type ReleaseRow,
} from './media-release-records';
import { youthRoundShareableSql, youthRoundSql } from './youth-round-sql';
import type { Tx } from './tx';

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

  async function minorFacts(tx: Tx, userId: string, now: Date, lock = true) {
    // The minor's account row orders every command about them; a page's
    // read takes no lock, so a link scanner never waits on a command.
    if (lock)
      await tx.execute(
        sql`select 1 from users where id = ${userId} for update`,
      );
    const releases = await readReleasesOf(tx, [userId], lock);
    const requests = await readRequestsOf(tx, userId, lock);
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

  /** The link by its digest, its request, and the minor's facts, locked for a command. */
  async function linkFacts(
    tx: Tx,
    digest: string,
    purpose: ReleaseLinkPurpose,
    lock = true,
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
        from media_release_links where token_digest = ${digest}
        ${lock ? sql`for update` : sql``}`,
    );
    if (link === undefined) return null;
    const [owner] = await rows<{ user_id: string }>(
      tx,
      sql`select user_id from media_release_requests where id = ${link.request_id}`,
    );
    if (owner === undefined) return null;
    const now = await readDatabaseTime(tx);
    const facts = await minorFacts(tx, owner.user_id, now, lock);
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
          sql`select count(distinct r.id)::int as n from rounds r
            join recordings rc on rc.round_id = r.id
            join round_participants rp on rp.round_id = r.id
            join actors a on a.id = rp.actor_id
            left join youth_round_publications p on p.round_id = r.id and p.ended_at is null
            where a.user_id = ${userId} and ${isDebatingSeatSql(sql`rp.seat_kind`)}
              and public.daisy_round_participant_is_current(rp.id)
              and ${youthRoundSql(sql`r.id`)} and p.round_id is null
              and ${youthRoundShareableSql(sql`r`)}`,
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
              recipient_hash, requested_at, expires_at, sends, last_sent_at)
            values (${requestId}, ${command.userId}, ${decision.recipientEmail},
              ${command.recipientHash},
              ${now.toISOString()}, ${releaseRequestExpiry(now.getTime())}, 1,
              ${now.toISOString()})`,
        );
        await queueMediaReleaseMail(tx, {
          id: nextId(),
          kind: 'request',
          requestId,
          at: nowSql,
        });
        await queueMediaReleaseMail(tx, {
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
        await queueMediaReleaseMail(tx, {
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
        const facts = await linkFacts(tx, digest, purpose, false);
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
          await insertMediaRelease(tx, {
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
        await queueMediaReleaseMail(tx, {
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
          await queueMediaReleaseMail(tx, {
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
          await insertMediaRelease(tx, {
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
        await queueMediaReleaseMail(tx, {
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
            await queueMediaReleaseMail(tx, {
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
        // Its open requests end now, so no reminder or resend reaches it.
        await tx.execute(
          sql`update media_release_requests set outcome = 'stopped',
              resolved_at = clock_timestamp()
            where recipient_hash = ${recipientHash} and outcome is null`,
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
