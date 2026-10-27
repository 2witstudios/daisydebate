import type {
  RoundBallotAuthority,
  RoundCommandPrincipal,
  RoundRefusal,
} from '@daisy/protocol';
import {
  bindOwnedRoundSeat,
  roundPrincipalAdmitted,
  runScopeMatches,
} from './round-principal';
/** The assigned judge is re-bound from fresh fenced facts on submissions and replays. */
export function bindRoundBallotPrincipal(input: {
  readonly principal: RoundCommandPrincipal;
  readonly judgeParticipantId: string;
  readonly authority: RoundBallotAuthority;
}):
  | {
      readonly ok: true;
      readonly actorId: string;
      readonly participantId: string;
    }
  | { readonly ok: false; readonly refusal: RoundRefusal } {
  const { principal, authority, judgeParticipantId } = input;
  if (
    principal.kind === 'agent' &&
    (!runScopeMatches(principal, authority) ||
      authority.agentRun?.kind !== 'judging')
  )
    return { ok: false, refusal: 'not-authorized' };
  // A ballot is participation, never a withdrawal (ADR 0075).
  if (!roundPrincipalAdmitted(principal, authority.principalAccess, null))
    return { ok: false, refusal: 'not-authorized' };
  const seat = authority.participants.find((p) => p.id === judgeParticipantId);
  if (!seat || !seat.eligible || seat.role !== 'judge')
    return { ok: false, refusal: 'not-seated' };
  return bindOwnedRoundSeat(principal, seat);
}
