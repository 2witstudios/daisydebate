/**
 * Standing in a Round's live room, as a named read-only input: a seat, or a host
 * with no seat. Everyone else has none.
 */
export type LiveRoomStanding =
  | {
      readonly kind: 'seat';
      readonly role: string;
      readonly competitionType: 'ranked' | 'casual';
      readonly roundEnded: boolean;
      readonly debatersReadChat: boolean;
    }
  | { readonly kind: 'seatless-host' };

export type AudienceShown = {
  readonly chat: boolean;
  readonly reactions: boolean;
  readonly viewers: boolean;
};

const everything: AudienceShown = {
  chat: true,
  reactions: true,
  viewers: true,
};

/**
 * What a reader may see of the audience. Anyone with no seat, a seatless host
 * included, sees it all. During
 * the Round a seat sees no reactions or count; a debater on a non-ranked Round
 * reads chat unless the host turned it off, and on a ranked Round never, whatever
 * is stored; a judge does not. Afterwards a seat reads it like anyone (plan
 * section 5, owner 2026-11-02).
 */
export const audienceShownTo = (
  seat: LiveRoomStanding | null,
): AudienceShown => {
  if (seat === null || seat.kind === 'seatless-host' || seat.roundEnded)
    return everything;
  const debater = seat.role === 'affirmative' || seat.role === 'negative';
  return {
    chat: debater && seat.competitionType !== 'ranked' && seat.debatersReadChat,
    reactions: false,
    viewers: false,
  };
};
