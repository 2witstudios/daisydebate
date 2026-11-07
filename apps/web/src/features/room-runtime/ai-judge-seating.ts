import type { RoomAssemblyState, RoomView } from '@daisy/protocol';
import type { AllowanceDecision } from '@daisy/protocol/billing';

/** Display only. Seat mutations obtain a fresh allowance decision under the host fence. */
export async function roomAiJudgeSeating(
  state: Pick<RoomAssemblyState, 'hostActorId' | 'status' | 'competitionType'>,
  actorId: string,
  allowance: () => Promise<AllowanceDecision>,
): Promise<RoomView['aiJudgeSeating']> {
  if (
    state.hostActorId !== actorId ||
    state.status === 'started' ||
    state.status === 'closed'
  )
    return null;
  if (state.competitionType === 'ranked') return 'free';
  const decision = await allowance();
  if (decision.kind === 'refuse') return 'premium';
  return decision.reservations.some((entry) => entry.source.kind === 'lifetime')
    ? 'free'
    : 'included';
}
