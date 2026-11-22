import { aiRoleOfSeat } from '@daisy/protocol/ai-roles';
import { type SeatKind } from '@daisy/protocol/seats';
import type { AiSeatAvailability } from '../../server/round-worker-policy';

/** Whether this deployment serves an AI in a kind of seat (no AI moderates). */
export const aiServesSeat = (
  available: AiSeatAvailability,
  kind: SeatKind,
): boolean => {
  const role = aiRoleOfSeat(kind);
  return role !== null && available[role];
};
