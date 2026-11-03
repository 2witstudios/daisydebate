/**
 * Shared media's own bound. It runs from the final segment's end and borrows
 * nothing from judging: the ballot deadline is `judgingPolicy`'s, from the freeze.
 */
export const roundMediaPolicy = {
  /** How long the room stays open after the final segment ends. */
  windowAfterFinalSegmentMs: 30 * 60_000,
} as const;
