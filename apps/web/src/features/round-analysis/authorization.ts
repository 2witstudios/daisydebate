import { authorize } from '@daisy/auth/authorization';
import type { RoundAnalysisAccess } from '@daisy/db/rounds';

/** Current own-seat authority. Fresh work additionally requires atomic allowance admission. */
export function canUseRoundAnalysis(
  access: RoundAnalysisAccess,
  capability: 'round.analysis.read' | 'round.analysis.request',
) {
  const { account, round } = access;
  if (!account?.actorId) return false;
  return authorize({
    principal: {
      kind: 'user',
      userId: account.userId,
      actorId: account.actorId,
    },
    capability,
    resource: round,
    context: { account },
  }).allow;
}
