import { createRefusal } from '@daisy/errors';
import { roundStatus } from '@daisy/protocol/round';

/** Fresh panel completion needs an active Round; terminal receipts replay separately. */
function requireActivePanelRound(round: { readonly status: string }): void {
  if (round.status !== roundStatus.active)
    throw createRefusal('CONFLICT', 'attendance-terminal');
}

/** Every segment has played; judges, if any, may still have no ruling. */
export function requirePanelRound<
  Round extends {
    readonly segments: readonly { readonly endedAt: string | null }[];
  },
>(round: Round | null | undefined): asserts round is Round {
  if (!round || round.segments.some((segment) => segment.endedAt === null))
    throw createRefusal('CONFLICT', 'panel-ineligible');
}

export const panelAdmission = {
  requireActiveRound: requireActivePanelRound,
  requirePlayedRound: requirePanelRound,
};
