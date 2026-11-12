import type { MediaRoomFacts, MediaRoomFate } from '@daisy/protocol';

/**
 * The node holding an occupied room has gone. LiveKit has no room migration, and for
 * many seconds a surviving node still lists the room as it was, occupied, under the same
 * id. A seat whose signal runs through a survivor hears nothing for about 15 s. So the
 * server asks the room's node directly, and also reads a room rebuilt under a new id. A
 * room nobody occupied can vanish harmlessly, and with no capture agent to stay behind,
 * an empty room may only mean everyone reloaded.
 */
export const mediaRoomLost = (
  facts: Pick<
    MediaRoomFacts,
    'lastOccupiedSid' | 'sawCapture' | 'seen' | 'call'
  >,
): boolean => {
  const { seen, lastOccupiedSid, sawCapture } = facts;
  if (seen === null) return false;
  // Nothing is rescued from a room about to be deleted for the call.
  if (facts.call === 'opening') return false;
  // A post-round call's room has no capture agent holding it open: the vendor
  // closes it once everyone has left, which is vacancy and never a loss.
  if (seen.kind === 'absent')
    return facts.call === 'none' && (lastOccupiedSid !== null || sawCapture);
  if (lastOccupiedSid !== null && seen.sid !== lastOccupiedSid) return true;
  if (lastOccupiedSid !== null && seen.answered === false) return true;
  return seen.empty && sawCapture;
};

/**
 * The one decision (ADR 0110). Observed absence settles it at once. Otherwise uncertainty
 * older than the bound moves an open Round to a fresh room with the node still silent,
 * because a late outcome can then reach only the old room. A terminal session waits for
 * proof, since ending it stops every later delete attempt. A post-round call opens only
 * on that same proof (ADR 0126).
 */
export const mediaRoomFate =
  (retireAfterMs: number) =>
  (facts: MediaRoomFacts): MediaRoomFate => {
    const uncertain = facts.uncertainSinceMs !== null;
    if (!facts.terminal && !facts.ended && mediaRoomLost(facts))
      return { kind: 'rotate', cause: 'lost' };
    if (facts.call === 'opening')
      // Only proof moves on: a token for the call's room must never exist while
      // the observer, the capture agent or a bot could still be in the old one.
      return facts.absenceProven && !facts.ended
        ? { kind: 'open-post-round-call' }
        : { kind: 'keep' };
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
