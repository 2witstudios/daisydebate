import type { SeatGrantFacts } from '@daisy/protocol';

/**
 * True for a bot seat holding a grant it did not use: not its scheduled turn,
 * and no authored speech in it (ADR 0122). It owes no stream, so nothing of it
 * can be missing. Its scheduled turn stays owed, so a bot that fails to speak
 * never passes as complete, and a turn the rules cannot name stays owed. The
 * freeze decides by this one rule (ISSUE-965).
 */
export function botGrantUnused({
  seat,
  turn,
  hasAuthoredSpeech,
}: SeatGrantFacts): boolean {
  if (seat.kind !== 'bot' || hasAuthoredSpeech || turn === undefined)
    return false;
  return (
    (turn.side !== undefined && turn.side !== seat.role) ||
    (turn.slot !== undefined && turn.slot !== seat.slot)
  );
}
