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
  readonly proposed?: boolean;
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
        title: 'Display name and image',
        where: 'Detail and profile',
        tag: 'personal',
        visibility: 'public',
      },
      {
        title: 'Rating, rank, band, W–L',
        where: 'Everywhere on the ladder',
        note: 'Competitive result, not personal data.',
        tag: 'none',
      },
      {
        title: 'Rating history and recent ranked results',
        where: 'Detail and profile',
        note: 'Opponent handles shown are their public usernames.',
        tag: 'identifier',
        visibility: 'public',
      },
      { title: 'Seasons played', where: 'Detail', tag: 'none' },
      {
        title: 'Region',
        where: 'Only if the debater chose to show it',
        note: 'A new column. Off by default. Needs its classification in the PR that adds it.',
        tag: 'personal',
        visibility: 'public',
        proposed: true,
      },
    ],
  },
  {
    title: 'Private',
    lede: 'Never shown on a ladder.',
    rows: [
      {
        title: 'Email',
        where: 'Sign-in only',
        tag: 'personal',
        visibility: 'private',
      },
      {
        title: 'IP address and user agent',
        where: 'Security only',
        tag: 'personal',
        visibility: 'private',
      },
      {
        title: 'Consent choices',
        where: 'Yours to see',
        tag: 'personal',
        visibility: 'private',
      },
      {
        title: 'Who judged a debate, and ballots',
        where:
          'Judges are assigned by the system. Identities stay off the ladder and profiles.',
        tag: 'identifier',
      },
      {
        title: 'Your private and unlisted debates',
        where: 'Never listed, and never rated',
        tag: 'none',
      },
    ],
  },
  {
    title: 'Hidden on purpose',
    lede: 'Masked or removed to protect fairness and people.',
    rows: [
      {
        title: 'Ratings while you judge',
        where:
          'If you are assigned a debate, the two debaters show Hidden until your ballot is in.',
        tag: 'blind judging',
      },
      {
        title: 'Deleted accounts',
        where:
          'Name and image are removed. The rating, rank and history stay so other ranks do not move.',
        tag: 'tombstone',
      },
      {
        title: 'Provisional debaters',
        where:
          'Listed only under Everyone, with no rank, so a lucky start is not a headline.',
        tag: 'unranked',
      },
      {
        title: 'Logs and analytics',
        where:
          'Record the route pattern and never a handle, email or search text.',
        tag: 'ADR 0036',
      },
    ],
  },
];

export type SettingProposal = {
  readonly id: 'show-region' | 'appear-on-ladder';
  readonly label: string;
  readonly help: string;
  readonly on: boolean;
};

/**
 * The two privacy settings the design proposes. Both are undecided (owner
 * decision pending) and there is no settings backend, so neither saves: the
 * switches start in their proposed state and move on the page only.
 */
export const settingsProposal: readonly SettingProposal[] = [
  {
    id: 'show-region',
    label: 'Show my region on leaderboards',
    help: 'Lets other debaters filter by region and see yours. Off until you turn it on.',
    on: false,
  },
  {
    id: 'appear-on-ladder',
    label: 'Appear on public leaderboards',
    help: 'Needs an owner decision. Today the ladder is public (ADR 0048). If this is allowed, a hidden debater still keeps a rating and still appears as “[private debater]” so ranks do not shift.',
    on: true,
  },
];
