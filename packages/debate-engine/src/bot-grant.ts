/** One seat's grant in one segment, as read. */
export type SeatGrantFacts = {
  readonly seat: {
    readonly kind: 'human' | 'bot';
    readonly role: string;
    readonly slot: number;
  };
  /** The frozen rules' entry for the grant's segment, when they can name one. */
  readonly turn:
    | { readonly side?: string | undefined; readonly slot?: number | undefined }
    | undefined;
  readonly hasCreditedWindow: boolean;
};

/**
 * True for a bot seat holding a grant it did not use: not its scheduled turn,
 * and no credited publication window. It owes no stream, so nothing of it can
 * be missing. Its scheduled turn stays owed, so a bot that fails to speak never
 * passes as complete, and a turn the rules cannot name stays owed. The seal and
 * the freeze both decide by this one rule (ISSUE-965).
 */
export function botGrantUnused({
  seat,
  turn,
  hasCreditedWindow,
}: SeatGrantFacts): boolean {
  if (seat.kind !== 'bot' || hasCreditedWindow || turn === undefined)
    return false;
  return (
    (turn.side !== undefined && turn.side !== seat.role) ||
    (turn.slot !== undefined && turn.slot !== seat.slot)
  );
}
