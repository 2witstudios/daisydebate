/**
 * Every admin credential's lifetime, as pure decisions over injected time
 * (ADR 0076). The database enforces single use; these rules decide expiry.
 */
const minute = 60_000;
const ENROLLMENT_TTL_MS = 15 * minute;
export const CHALLENGE_TTL_MS = 2 * minute;
export const SESSION_ABSOLUTE_MS = 12 * 60 * minute;
export const SESSION_IDLE_MS = 30 * minute;

const plus = (iso: string, ms: number) =>
  new Date(Date.parse(iso) + ms).toISOString();

export const enrollmentExpiry = (now: string) => plus(now, ENROLLMENT_TTL_MS);
export const challengeExpiry = (now: string) => plus(now, CHALLENGE_TTL_MS);
export const sessionExpiry = (now: string) => plus(now, SESSION_ABSOLUTE_MS);

export type SessionFacts = {
  readonly lastSeenAt: string;
  readonly expiresAt: string;
  readonly revokedAt: string | null;
};
export type OperatorState = { readonly disabledAt: string | null } | null;
export type SessionVerdict =
  'active' | 'revoked' | 'expired' | 'idle' | 'operator_disabled';

/**
 * Checked on every request, server-side: a revoked or expired session is
 * dead, and so is one whose operator is now disabled or gone, which the
 * caller revokes.
 */
export function sessionVerdict(
  session: SessionFacts,
  operator: OperatorState,
  now: string,
): SessionVerdict {
  const at = Date.parse(now);
  if (session.revokedAt !== null) return 'revoked';
  if (at >= Date.parse(session.expiresAt)) return 'expired';
  if (at - Date.parse(session.lastSeenAt) >= SESSION_IDLE_MS) return 'idle';
  if (operator === null || operator.disabledAt !== null)
    return 'operator_disabled';
  return 'active';
}
