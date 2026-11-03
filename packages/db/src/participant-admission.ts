import type { AgeBand } from '@daisy/auth';
import { createAppError } from '@daisy/errors';
import type { RoundCommandAuthority } from '@daisy/protocol';
import { sql, type SQL } from 'drizzle-orm';
import type { lockAuthorizationActors } from './authorization';
import { restrictionInForce } from './moderation/in-force';

/** A human principal's own access facts, read under the account fence. */
export type PrincipalAccess = NonNullable<
  RoundCommandAuthority['principalAccess']
>;

/**
 * ADR 0075: whether those facts hold participant access. The rule lives in
 * `@daisy/auth`; the caller injects it, so this adapter decides nothing.
 */
export type ParticipantAdmission = (access: PrincipalAccess) => boolean;

/**
 * ADR 0075's facts, for a query over many accounts: the account named by
 * `userId` is approved, unrestricted at `at`, and in a band the caller's rule
 * admits. The grandfathered cohort was approved with no age check, so approval
 * never stands for age. A missing or invalid age record matches no band. The
 * band stays inside the predicate: this read returns no age data.
 */
export const admittedParticipant = (
  userId: SQL,
  at: Date,
  admittedAgeBands: readonly AgeBand[],
) => sql`(
  exists (select 1 from account_beta_access access
    where access.user_id = ${userId} and access.state = 'approved')
  and not ${restrictionInForce(userId, at)}
  and (select public.daisy_age_band(age.birth_month, age.version, age.recorded_at, ${at}::timestamptz)
    from account_age age where age.user_id = ${userId})
    = any(string_to_array(${admittedAgeBands.join(',')}, ','))
)`;

type FencedAccounts = Awaited<ReturnType<typeof lockAuthorizationActors>>;

/** The commanding human's fenced facts; an absent account has none. */
export function principalAccessOf(
  accounts: FencedAccounts,
  actorId: string,
): PrincipalAccess {
  const account = accounts.find((a) => a?.actorId === actorId);
  return account
    ? {
        beta: account.beta?.state ?? null,
        ageBand: account.ageBand,
        restricted: account.restricted,
      }
    : { beta: null, ageBand: null, restricted: false };
}

/**
 * The human seats whose own fenced facts no longer hold participant access
 * (ISSUE-714): seats stay membership-only for the Round (DEC-249), but media
 * grants these none, so a revoked human already in the room stops publishing.
 */
export function withdrawnSeats(
  participants: readonly {
    readonly id: string;
    readonly actorId: string;
    readonly kind: 'human' | 'bot';
  }[],
  accounts: FencedAccounts,
  admits: ParticipantAdmission,
): readonly string[] {
  return participants
    .filter(
      (seat) =>
        seat.kind === 'human' &&
        !admits(principalAccessOf(accounts, seat.actorId)),
    )
    .map((seat) => seat.id);
}

/**
 * Refuses a human whose own fenced facts lack participant access, read
 * after any lock wait (ADR 0075, DEC-249): a revoke that commits after the
 * HTTP edge's identity read still refuses here.
 */
export function requireAdmittedPrincipal(
  admits: ParticipantAdmission,
  accounts: FencedAccounts,
  actorId: string,
): void {
  if (!admits(principalAccessOf(accounts, actorId)))
    throw createAppError('AUTHORIZATION');
}
