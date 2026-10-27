import { createAppError } from '@daisy/errors';
import type { RoundCommandAuthority } from '@daisy/protocol';
import type { lockAuthorizationActors } from './authorization';

/** A human principal's own access facts, read under the account fence. */
export type PrincipalAccess = NonNullable<
  RoundCommandAuthority['principalAccess']
>;

/**
 * ADR 0075: whether those facts hold participant access. The rule lives in
 * `@daisy/auth`; the caller injects it, so this adapter decides nothing.
 */
export type ParticipantAdmission = (access: PrincipalAccess) => boolean;

type FencedAccounts = Awaited<ReturnType<typeof lockAuthorizationActors>>;

/** The commanding human's fenced facts; an absent account has none. */
export function principalAccessOf(
  accounts: FencedAccounts,
  actorId: string,
): PrincipalAccess {
  const account = accounts.find((a) => a?.actorId === actorId);
  return account
    ? { beta: account.beta?.state ?? null, ageBand: account.ageBand }
    : { beta: null, ageBand: null };
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
