import type {
  RoundCommandAuthority,
  RoundCommandPrincipal,
  RoundRefusal,
} from '@daisy/protocol';

export function runScopeMatches(
  principal: Extract<RoundCommandPrincipal, { kind: 'agent' }>,
  authority: Pick<RoundCommandAuthority, 'roundId' | 'agentRun'>,
): boolean {
  const run = authority.agentRun;
  return (
    principal.roundId === authority.roundId &&
    run !== null &&
    run.active &&
    run.id === principal.agentRunId &&
    run.participantId === principal.participantId &&
    run.serviceId === principal.serviceId
  );
}
function ownsRoundSeat(
  principal: RoundCommandPrincipal,
  seat: RoundCommandAuthority['participants'][number],
): boolean {
  return principal.kind === 'human'
    ? seat.kind === 'human' && seat.actorId === principal.actorId
    : seat.kind === 'bot' && seat.id === principal.participantId;
}

/** Shared seat binding keeps command and ballot refusal semantics identical. */
export function bindOwnedRoundSeat(
  principal: RoundCommandPrincipal,
  seat: RoundCommandAuthority['participants'][number],
):
  | {
      readonly ok: true;
      readonly actorId: string;
      readonly participantId: string;
    }
  | { readonly ok: false; readonly refusal: RoundRefusal } {
  return ownsRoundSeat(principal, seat)
    ? { ok: true, actorId: seat.actorId, participantId: seat.id }
    : { ok: false, refusal: 'not-authorized' };
}
