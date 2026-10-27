import type {
  RoundCommandAuthority,
  RoundCommandPrincipal,
  RoundRefusal,
} from '@daisy/protocol';
import { participantAccess } from './participant-access';

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

/**
 * ADR 0075: Round commands a human keeps without participant access, the
 * Round's own withdrawal (leaving it), as `admitsCapability` keeps leaving
 * a Room.
 */
const roundWithdrawals: readonly string[] = ['forfeit'];

/**
 * A human principal commands or judges only with participant access, read
 * under the fence after any lock wait; a withdrawal needs none. Seats stay
 * membership-only, so a revoked opponent never blocks this Round.
 */
export function roundPrincipalAdmitted(
  principal: RoundCommandPrincipal,
  access: RoundCommandAuthority['principalAccess'],
  commandType: string | null,
): boolean {
  if (principal.kind !== 'human') return true;
  if (commandType !== null && roundWithdrawals.includes(commandType))
    return true;
  return participantAccess(
    access && {
      beta: access.beta && { state: access.beta },
      ageBand: access.ageBand,
    },
  );
}
