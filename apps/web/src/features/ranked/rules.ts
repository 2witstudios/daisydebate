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
    body: 'Every ranked debate uses the standard rules. Custom rules are for casual tables.',
  },
  {
    id: 'assigned-judge',
    icon: 'gavel',
    title: 'Assigned judge',
    body: 'You cannot choose a judge. Judges never see ratings.',
  },
  {
    id: 'conduct',
    icon: 'users',
    title: 'Conduct',
    body: `One profile per person, no outside help. Missing a speech by ${checkInGraceSeconds} seconds is a forfeit and a rated loss.`,
  },
  {
    id: 'how-it-works',
    icon: 'chart',
    title: 'How ranked works',
    body: `One rating per season, provisional for your first ${provisionalDebates} debates. You are matched near your rating.`,
  },
];
