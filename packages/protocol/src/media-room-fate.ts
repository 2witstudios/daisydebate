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
  /** LiveKit's id for the room as it stood when last occupied, or null. */
  readonly lastOccupiedSid: string | null;
  /** The last pass that read the room saw the capture agent in it. */
  readonly sawCapture: boolean;
  /** What this pass read of the room; null if it read nothing. */
  readonly seen: {
    /** LiveKit's id for the room now, or null when it is absent. */
    readonly sid: string | null;
    readonly empty: boolean;
    /**
     * The room's node answered a call only it can serve; null when not asked. A dead
     * node's room still reads as occupied, under the same id, through a surviving node.
     */
    readonly answered: boolean | null;
  } | null;
};

/** What happens to the room. Each variant is one outcome, with nothing left to derive. */
export type MediaRoomFate =
  | { readonly kind: 'keep' }
  /** The Round is over and the room is proven gone: the session ends. */
  | { readonly kind: 'end' }
  /** The session moves to a fresh room, with its remaining seats. */
  | {
      readonly kind: 'rotate';
      readonly cause: 'absent' | 'unreachable' | 'seat-revoked' | 'lost';
    }
  /** The room is proven gone and nothing requires a new one yet. */
  | { readonly kind: 'clear' };
