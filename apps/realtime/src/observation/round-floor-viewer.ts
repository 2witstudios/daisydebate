import { decideRoundFloor } from '@daisy/auth/round-floor';
import type { RoundFloorFact } from '@daisy/protocol/round-floor';
import type { loadAuthorizationSession } from '@daisy/db/authorization';
import type { SocketPrincipal } from '../registry';
import { contextChannelPermit } from './context-channel-permit';
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
  return contextChannelPermit({
    session,
    decision: decideRoundFloor({
      principal,
      account: session.account,
      fact,
      action: 'read',
      now: instant,
    }),
    disclosureRevision: fact.revision,
    contentRevision,
    started,
    now,
    instant,
  });
}
