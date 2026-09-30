/** Facts the rules copy states, from ADR 0033 and the Ratings epic. */
export type RankedFacts = {
  /** Ranked debates before a rating stops being provisional. */
  readonly provisionalDebates: number;
  /** Seconds to be present when a speech starts (ADR 0033 check-in grace). */
  readonly checkInGraceSeconds: number;
};

export type RankedRule = {
  readonly id: 'standard-rules' | 'assigned-judge' | 'conduct' | 'how-it-works';
  /** An icon name the presentation layer knows. */
  readonly icon: 'book' | 'gavel' | 'users' | 'chart';
  readonly title: string;
  readonly body: string;
};

/** The rules of Ranked as the drawer states them (ADR 0030, 0033, 0048). */
export const rankedRules = ({
  provisionalDebates,
  checkInGraceSeconds,
}: RankedFacts): readonly RankedRule[] => [
  {
    id: 'standard-rules',
    icon: 'book',
    title: 'Standard rules',
    body: 'Every ranked debate runs the same standard rules, with nothing customised, so a rating means the same thing for everyone. Only casual tables can use custom rules.',
  },
  {
    id: 'assigned-judge',
    icon: 'gavel',
    title: 'Assigned judge',
    body: 'Daisy assigns the judge. You cannot choose or request one, and judges never see ratings while judging.',
  },
  {
    id: 'conduct',
    icon: 'users',
    title: 'Conduct',
    body: `One debater profile per person, human debaters only, no outside help. Be in the room within ${checkInGraceSeconds} seconds of a speech starting or it is a forfeit, which counts as a rated loss.`,
  },
  {
    id: 'how-it-works',
    icon: 'chart',
    title: 'How ranked works',
    body: `You have one rating per season. It is provisional until you finish ${provisionalDebates} ranked debates, then established. You are matched near your rating, and a new season starts ratings fresh.`,
  },
];
