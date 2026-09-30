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
  attachCard: { label: 'Attach a card', reason: notBuilt('Attaching a card') },
  addContention: {
    label: 'Add contention',
    reason: notBuilt('Adding a contention'),
  },
  addResponse: {
    label: 'Add a response',
    reason: notBuilt('Adding a response'),
  },
  addToCase: {
    label: 'Add to case',
    reason: notBuilt('Adding a brief to a case'),
  },
  saveBrief: { label: 'Save changes', reason: notBuilt('Saving a brief') },
  shareCase: { label: 'Share', reason: notBuilt('Sharing a case') },
  addBlock: { label: 'Add to speech', reason: notBuilt('Adding to a speech') },
  saveVersion: { label: 'Save version', reason: notBuilt('Saving a version') },
  restoreVersion: {
    label: 'Restore as a new version',
    reason: notBuilt('Restoring a version'),
  },
  exportPdf: { label: 'Export PDF', reason: notBuilt('Exporting a file') },
  print: { label: 'Print', reason: notBuilt('Printing') },
  copyText: { label: 'Copy as text', reason: notBuilt('Copying as text') },
  stopSharing: {
    label: 'Stop sharing',
    reason: notBuilt('Changing who can see a brief'),
  },
  addGrant: { label: 'Add', reason: notBuilt('Sharing') },
  comment: { label: 'Comment', reason: notBuilt('Comments') },
  reply: { label: 'Reply', reason: notBuilt('Comments') },
  resolve: { label: 'Resolve', reason: notBuilt('Comments') },
  invite: { label: 'Invite', reason: notBuilt('Invitations') },
  sendInvite: { label: 'Send invite', reason: notBuilt('Invitations') },
  manageMember: { label: 'Manage', reason: notBuilt('Managing members') },
  leaveTeam: { label: 'Leave team', reason: notBuilt('Leaving a team') },
  sendCard: {
    label: 'Send card',
    reason: notBuilt('Sending a card to the room'),
  },
  copyCiteInRoom: {
    label: 'Copy cite',
    reason:
      'The citation format is an open product decision, so there is nothing to copy yet.',
  },
  deleteCard: { label: 'Delete card', reason: notBuilt('Deleting a card') },
} as const satisfies Record<string, InertAction>;
