import { decideRoundFloor } from '@daisy/auth/round-floor';
import { observationPermitMs } from '@daisy/protocol';
import type { RoundFloorFact } from '@daisy/protocol/round-floor';
import type { loadAuthorizationSession } from '@daisy/db/authorization';
import type { SocketPrincipal } from '../registry';
import type { PermitDecision } from './permits';

/** A current fenced session and floor fact grant one shared projection, bounded from read start. */
export function decideRoundFloorPermit({
  principal,
  session,
  fact,
  contentRevision,
  started,
  now,
  instant,
}: {
  readonly principal: SocketPrincipal;
  readonly session: Awaited<ReturnType<typeof loadAuthorizationSession>>;
  readonly fact: RoundFloorFact;
  readonly contentRevision: number;
  readonly started: number;
  readonly now: number;
  readonly instant: string;
}): PermitDecision {
  if (!session) return { status: 'denied' };
  const decision = decideRoundFloor({
    principal,
    account: session.account,
    fact,
    action: 'read',
    now: instant,
  });
  if (!decision.allow) return { status: 'denied' };
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
    disclosureRevision: fact.revision,
    minimumContentRevision: contentRevision,
    validUntil,
  };
}
