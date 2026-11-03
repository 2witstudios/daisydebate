import type { MediaRoomFacts, MediaRoomFate } from '@daisy/protocol';

/**
 * The one decision (ADR 0110). Observed absence settles it at once. Otherwise uncertainty
 * older than the bound moves an open Round to a fresh room with the node still silent,
 * because a late outcome can then reach only the old room. A terminal session waits for
 * proof, since ending it stops every later delete attempt.
 */
/**
 * The node holding an occupied room has gone. LiveKit has no room migration: whoever
 * joins next rebuilds the room on a live node under a new id, and a seat whose signal
 * runs through a surviving node hears nothing about it for about 15 s. So the server
 * reads the loss itself. A room nobody occupied can vanish harmlessly, and with no
 * capture agent to stay behind, an empty room may only mean everyone reloaded.
 */
export const mediaRoomLost = (
  facts: Pick<MediaRoomFacts, 'lastOccupiedSid' | 'sawCapture' | 'seen'>,
): boolean => {
  const { seen, lastOccupiedSid } = facts;
  if (seen === null) return false;
  if (lastOccupiedSid !== null && seen.sid !== lastOccupiedSid) return true;
  return seen.empty && facts.sawCapture;
};

export const mediaRoomFate =
  (retireAfterMs: number) =>
  (facts: MediaRoomFacts): MediaRoomFate => {
    const uncertain = facts.uncertainSinceMs !== null;
    if (!facts.terminal && !facts.ended && mediaRoomLost(facts))
      return { kind: 'rotate', cause: 'lost' };
    if (facts.absenceProven) {
      if (facts.terminal) return { kind: 'end' };
      if (facts.ended) return { kind: 'clear' };
      if (uncertain) return { kind: 'rotate', cause: 'absent' };
      return facts.seatRevoked
        ? { kind: 'rotate', cause: 'seat-revoked' }
        : { kind: 'clear' };
    }
    return uncertain &&
      !facts.terminal &&
      !facts.ended &&
      facts.nowMs - facts.uncertainSinceMs! >= retireAfterMs
      ? { kind: 'rotate', cause: 'unreachable' }
      : { kind: 'keep' };
  };
