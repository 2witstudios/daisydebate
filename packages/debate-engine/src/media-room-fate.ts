import type { MediaRoomRule } from '@daisy/protocol';

/**
 * The one decision (ADR 0110). Observed absence settles it at once. Otherwise uncertainty
 * older than the bound moves an open Round to a fresh room with the node still silent,
 * because a late outcome can then reach only the old room. A terminal session waits for
 * proof, since ending it stops every later delete attempt.
 */
export const mediaRoomFate =
  (retireAfterMs: number): MediaRoomRule =>
  (facts) => {
    const uncertain = facts.uncertainSinceMs !== null;
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
