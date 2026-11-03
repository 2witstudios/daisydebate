/** What a reconcile pass found about a session's vendor room. */
export type MediaRoomFacts = {
  readonly nowMs: number;
  /** The media window has closed: the room should be gone for good. */
  readonly terminal: boolean;
  /** The session already ended, in an earlier pass. */
  readonly ended: boolean;
  /** The room was observed absent, after every intent known to this pass. */
  readonly absenceProven: boolean;
  /** A bound seat has lost its place, so its token must stop opening the room. */
  readonly seatRevoked: boolean;
  /** When the room's state became unknown, or null when it is known. */
  readonly uncertainSinceMs: number | null;
};

/** What happens to the room. Each variant is one outcome, with nothing left to derive. */
export type MediaRoomFate =
  | { readonly kind: 'keep' }
  /** The Round is over and the room is proven gone: the session ends. */
  | { readonly kind: 'end' }
  /** The session moves to a fresh room, with its remaining seats. */
  | {
      readonly kind: 'rotate';
      readonly cause: 'absent' | 'unreachable' | 'seat-revoked';
    }
  /** The room is proven gone and nothing requires a new one yet. */
  | { readonly kind: 'clear' };

export type MediaRoomRule = (facts: MediaRoomFacts) => MediaRoomFate;

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
