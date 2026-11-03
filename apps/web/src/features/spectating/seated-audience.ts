/** A seat on the Round, as a named read-only input. */
export type AudienceSeat = {
  readonly role: string;
  readonly competitionType: 'ranked' | 'casual';
  readonly roundEnded: boolean;
  readonly debatersReadChat: boolean;
};

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
 * What a reader may see of the audience. Anyone with no seat sees it all. During
 * the Round a seat sees no reactions or count; a debater on a non-ranked Round
 * reads chat unless the host turned it off, and on a ranked Round never, whatever
 * is stored; a judge does not. Afterwards a seat reads it like anyone (plan
 * section 5, owner 2026-11-02).
 */
export const audienceShownTo = (seat: AudienceSeat | null): AudienceShown => {
  if (seat === null || seat.roundEnded) return everything;
  const debater = seat.role === 'affirmative' || seat.role === 'negative';
  return {
    chat: debater && seat.competitionType !== 'ranked' && seat.debatersReadChat,
    reactions: false,
    viewers: false,
  };
};
