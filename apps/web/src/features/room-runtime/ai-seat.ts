import type { SeatKind } from '@daisy/protocol';
import type { AiSeatAvailability } from '../../server/round-worker-policy';

/**
 * The AI seat that fills a kind of Room seat: a competitor's seat is a bot
 * debater's, a judge's the AI judge's; no AI moderates.
 */
export const aiSeatOf = (kind: SeatKind): keyof AiSeatAvailability | null => {
  switch (kind) {
    case 'side':
    case 'speaker':
      return 'debater';
    case 'judge':
      return 'judge';
    case 'moderator':
      return null;
  }
};

/** Whether this deployment serves an AI in a kind of seat. */
export const aiServesSeat = (
  available: AiSeatAvailability,
  kind: SeatKind,
): boolean => {
  const seat = aiSeatOf(kind);
  return seat !== null && available[seat];
};
