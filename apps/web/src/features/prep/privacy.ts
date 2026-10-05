/**
 * What stays private, in plain words for the people whose prep it is. The
 * internal data classification lives in the privacy docs, not on this page.
 */
export const privacyPromises: readonly {
  readonly title: string;
  readonly body: string;
  readonly symbol: 'lock' | 'share' | 'eyeOff';
}[] = [
  {
    title: 'Private by default',
    body: 'Every card, brief and case starts visible to you alone.',
    symbol: 'lock',
  },
  {
    title: 'Sharing is named and reversible',
    body: 'You pick who and the permission. Stopping removes access at once.',
    symbol: 'share',
  },
  {
    title: 'Never part of a debate',
    body: 'Opponents, judges, spectators and recordings never see your prep.',
    symbol: 'eyeOff',
  },
];

export const privacyRows: readonly (readonly [string, string, string])[] = [
  [
    'Cards, briefs and cases you create',
    'Only you',
    'Kept until you delete; erased with your account',
  ],
  [
    'Credibility notes and private notes',
    'Only you, even on shared items',
    'Deleted with the item',
  ],
  [
    'An item you share with a team',
    'You, plus the people and teams you named, at the permission you set',
    'Access ends when you stop sharing',
  ],
  [
    'Comments on a shared item',
    'People the item is shared with',
    'Deleted with the item; yours on request',
  ],
  ['Saved searches and reading pace', 'Only you', 'Erased with your account'],
  [
    'Prep panel during a debate',
    'Only you. Not opponents, judges or spectators, not recordings',
    'Nothing about what you open is logged to the room',
  ],
  [
    'An exported file or a printout',
    'Whoever you give it to',
    'Cannot be recalled',
  ],
];

/** Who sees the prep panel during a debate, and what they see instead. */
export const whoSeesInDebate: readonly {
  readonly who: string;
  readonly sees: string;
  readonly hasPanel: boolean;
}[] = [
  {
    who: 'You',
    sees: 'The room plus your prep panel.',
    hasPanel: true,
  },
  {
    who: 'Your opponent',
    sees: 'The room only.',
    hasPanel: false,
  },
  {
    who: 'Judge and spectators',
    sees: 'The room only.',
    hasPanel: false,
  },
];
