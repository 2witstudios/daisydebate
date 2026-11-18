import {
  isOpenRoomStatus,
  type RoomAssemblyState,
  type RoomView,
} from '@daisy/protocol';
import type { AllowanceDecision } from '@daisy/protocol/billing';

/** Display only. Seat mutations obtain a fresh allowance decision under the host fence. */
export async function roomAiJudgeSeating(
  state: Pick<RoomAssemblyState, 'hostActorId' | 'status' | 'competitionType'>,
  actorId: string,
  allowance: () => Promise<AllowanceDecision>,
): Promise<RoomView['aiJudgeSeating']> {
  if (state.hostActorId !== actorId || !isOpenRoomStatus(state.status))
    return null;
  if (state.competitionType === 'ranked') return 'free';
  const decision = await allowance();
  if (decision.kind === 'refuse')
    switch (decision.reason) {
      case 'abuse-ceiling':
        return 'fair-use';
      case 'free-judge-unbound':
        return 'with-bot';
      case 'free-limit-reached':
        return 'premium';
      case 'not-eligible':
      case 'renewal-grace':
      case 'invalid-facts':
        return 'not-included';
    }
  return decision.reservations.some((entry) => entry.source.kind === 'lifetime')
    ? 'free'
    : 'included';
}
