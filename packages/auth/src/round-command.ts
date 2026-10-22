import type {
  RoundCommandEnvelope,
  RoundCommandPrincipal,
  RoundCommandAuthority,
  RoundRefusal,
} from '@daisy/protocol';

function runScopeMatches(
  principal: Extract<RoundCommandPrincipal, { kind: 'agent' }>,
  authority: RoundCommandAuthority,
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
function ownsSeat(
  principal: RoundCommandPrincipal,
  seat: RoundCommandAuthority['participants'][number],
): boolean {
  return principal.kind === 'human'
    ? seat.kind === 'human' && seat.actorId === principal.actorId
    : seat.kind === 'bot' && seat.id === principal.participantId;
}
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
  return ownsSeat(principal, seat)
    ? { ok: true, actorId: seat.actorId, participantId: seat.id }
    : { ok: false, refusal: 'not-authorized' };
}
