/**
 * Where each Prep action goes, and which ones cannot work yet. There is no
 * backend, so a navigation points at the next mock screen and a mutation is
 * an explicitly inert control with its reason. The real operations replace
 * these entries here and nowhere else.
 */
export const prepDestinations = {
  library: '/prep',
  start: '/prep/start',
  addEvidence: '/prep/cards/new',
  importSource: '/prep/cards/new?src=file',
  newBrief: '/prep/briefs/new',
  privacy: '/prep/privacy',
} as const;

/** A control the backend will bring to life: shown, disabled, explained. */
export type InertAction = {
  readonly label: string;
  readonly reason: string;
};

const notBuilt = (what: string): string =>
  `${what} needs the Prep service, which is not built yet.`;

export const inertActions = {
  saveSearch: {
    label: 'Save this search',
    reason: notBuilt('Saving a search'),
  },
  createOrJoinTeam: {
    label: 'Create or join a team',
    reason: notBuilt('Teams'),
  },
  addToBrief: {
    label: 'Add to brief',
    reason: notBuilt('Adding a card to a brief'),
  },
  copyCite: {
    label: 'Copy cite',
    reason:
      'The citation format is an open product decision, so there is nothing to copy yet.',
  },
  share: { label: 'Share', reason: notBuilt('Sharing') },
  edit: { label: 'Edit', reason: notBuilt('Editing a card') },
  deleteCard: { label: 'Delete card', reason: notBuilt('Deleting a card') },
} as const satisfies Record<string, InertAction>;
