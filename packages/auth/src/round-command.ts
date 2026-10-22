import type {
  RoundCommandEnvelope,
  RoundCommandPrincipal,
  RoundParticipantSeat,
  RoundRefusal,
} from '@daisy/protocol';

export type RoundCommandAuthority = {
  readonly roundId: string;
  readonly hostActorId: string | null;
  readonly participants: readonly (RoundParticipantSeat & {
    readonly kind: 'human' | 'bot';
    readonly eligible: boolean;
  })[];
  readonly agentRun: {
    readonly id: string;
    readonly participantId: string;
    readonly serviceId: string;
    readonly active: boolean;
  } | null;
};
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
  if (principal.kind === 'agent') {
    const run = authority.agentRun;
    if (
      principal.roundId !== authority.roundId ||
      !run?.active ||
      run.id !== principal.agentRunId ||
      run.participantId !== principal.participantId ||
      run.serviceId !== principal.serviceId
    )
      return { ok: false, refusal: 'not-authorized' };
  }
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
  const bound =
    principal.kind === 'human'
      ? seat.kind === 'human' && seat.actorId === principal.actorId
      : seat.kind === 'bot' && seat.id === principal.participantId;
  return bound
    ? { ok: true, actorId: seat.actorId, participantId: seat.id }
    : { ok: false, refusal: 'not-authorized' };
}
