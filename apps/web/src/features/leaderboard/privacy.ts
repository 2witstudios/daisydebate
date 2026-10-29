/**
 * What the ladder shows, what stays private and what is hidden on purpose.
 * Categories and visibilities follow ADR 0036: a personal field has a
 * visibility, nothing else does.
 */
export type PrivacyRow = {
  readonly title: string;
  readonly where: string;
  readonly note?: string;
  /** The ADR 0036 category (none, identifier, personal, sensitive, secret), or a short label for a rule with no data. */
  readonly tag: string;
  readonly visibility?: 'public' | 'private';
  /** A field no column holds yet: its classification ships with its PR. */
};

export type PrivacySection = {
  readonly title: string;
  readonly lede: string;
  readonly rows: readonly PrivacyRow[];
};

export const privacySections: readonly PrivacySection[] = [
  {
    title: 'Public',
    lede: 'Anyone can see these, signed in or not.',
    rows: [
      {
        title: 'Username',
        where: 'Ladder row, hover card, detail, profile link',
        tag: 'personal',
        visibility: 'public',
      },
      {
        title: 'Rating, rank, W–L',
        where: 'Everywhere on the ladder',
        note: 'Rated competitive records remain after account closure.',
        tag: 'competitive record',
      },
      {
        title: 'Rating history and recent ranked results',
        where: 'Detail and profile',
        note: 'Opponent handles shown are their public usernames.',
        tag: 'identifier',
        visibility: 'public',
      },
      { title: 'Seasons played', where: 'Detail', tag: 'none' },
    ],
  },
  {
    title: 'Private',
    lede: 'Never shown on a ladder.',
    rows: [
      {
        title: 'Email',
        where: 'Not shown on the leaderboard',
        tag: 'personal',
        visibility: 'private',
      },
      {
        title: 'IP address and user agent',
        where: 'Not shown on the leaderboard',
        tag: 'personal',
        visibility: 'private',
      },
      {
        title: 'Consent choices',
        where: 'Not shown on the leaderboard',
        tag: 'personal',
        visibility: 'private',
      },
      {
        title: 'Who judged a debate, and ballots',
        where: 'Never on the ladder or profiles',
        tag: 'identifier',
      },
    ],
  },
  {
    title: 'Hidden on purpose',
    lede: 'Masked or removed to protect fairness and people.',
    rows: [
      {
        title: 'Ratings while you judge',
        where: 'The two debaters show Hidden until your ballot is in.',
        tag: 'blind judging',
      },
      {
        title: 'Closed accounts',
        where:
          'Username stays reserved and is marked closed. Email is removed.',
        tag: 'closed',
      },
      {
        title: 'Provisional debaters',
        where: 'Listed under Everyone, with no rank.',
        tag: 'unranked',
      },
      {
        title: 'Logs and analytics',
        where: 'Never record your handle, email or search text.',
        tag: 'minimised',
      },
    ],
  },
];
