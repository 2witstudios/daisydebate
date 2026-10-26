import type {
  RoundCommandEnvelope,
  RoundCommandPrincipal,
  RoundCommandAuthority,
  RoundRefusal,
} from '@daisy/protocol';

import { bindOwnedRoundSeat, runScopeMatches } from './round-principal';
/** Fresh locked facts bind a human session or scoped AgentRun to exactly its seat. */
export function bindRoundCommandPrincipal(input: {
  readonly principal: RoundCommandPrincipal;
  readonly command: RoundCommandEnvelope['command'];
  readonly authority: RoundCommandAuthority;
}):
  | {
      readonly ok: true;
      readonly actorId: string | null;
      readonly participantId: string | null;
    }
  | { readonly ok: false; readonly refusal: RoundRefusal } {
  const { principal, command, authority } = input;
  if (principal.kind === 'agent' && !runScopeMatches(principal, authority))
    return { ok: false, refusal: 'not-authorized' };
  if (command.type === 'start') {
    if (
      principal.kind !== 'human' ||
      principal.actorId !== authority.hostActorId
    )
      return { ok: false, refusal: 'not-authorized' };
    return { ok: true, actorId: null, participantId: null };
  }
  const seat = authority.participants.find(
    (p) => p.id === command.participantId,
  );
  if (!seat || !seat.eligible || seat.role === 'judge')
    return { ok: false, refusal: 'not-seated' };
  return bindOwnedRoundSeat(principal, seat);
}
