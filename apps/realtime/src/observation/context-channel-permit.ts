import { observationPermitMs } from '@daisy/protocol';
import type { loadAuthorizationSession } from '@daisy/db/authorization';
import type { PermitDecision } from './permits';

/**
 * One viewer's permit for a context channel, from its context's read decision:
 * the shared projection, bounded from read start by the standard permit, the
 * session and whatever expiry the context's authority carries.
 */
export function contextChannelPermit({
  session,
  decision,
  disclosureRevision,
  contentRevision,
  started,
  now,
  instant,
}: {
  readonly session: Awaited<ReturnType<typeof loadAuthorizationSession>>;
  readonly decision:
    | { readonly allow: false }
    | { readonly allow: true; readonly expiresAt: string | null };
  readonly disclosureRevision: number;
  readonly contentRevision: number;
  readonly started: number;
  readonly now: number;
  readonly instant: string;
}): PermitDecision {
  if (!session || !decision.allow) return { status: 'denied' };
  const bound = (expiry: string) =>
    now + Math.max(0, Date.parse(expiry) - Date.parse(instant));
  const validUntil = Math.min(
    started + observationPermitMs,
    bound(session.expiresAt),
    decision.expiresAt === null ? Infinity : bound(decision.expiresAt),
  );
  if (!Number.isFinite(validUntil) || validUntil <= now)
    return { status: 'denied' };
  return {
    status: 'allowed',
    partition: 'members',
    disclosureRevision,
    minimumContentRevision: contentRevision,
    validUntil,
  };
}
