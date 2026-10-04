/**
 * Where each Prep action goes, and which ones cannot work yet. There is no
 * backend, so a navigation points at the next mock screen and a mutation is
 * an explicitly inert control. The real operations replace these entries
 * here and nowhere else.
 */
export const prepDestinations = {
  library: '/prep',
  start: '/prep/start',
  addEvidence: '/prep/cards/new',
  importSource: '/prep/cards/new?src=file',
  newBrief: '/prep/briefs/new',
  privacy: '/prep/privacy',
} as const;

/** A control the backend will bring to life: shown and disabled. */
export type InertAction = {
  readonly label: string;
};

export const inertActions = {
  saveSearch: {
    label: 'Save this search',
  },
  createOrJoinTeam: {
    label: 'Create or join a team',
  },
  addToBrief: {
    label: 'Add to brief',
  },
  copyCite: {
    label: 'Copy cite',
  },
  share: { label: 'Share' },
  edit: { label: 'Edit' },
  attachCard: { label: 'Attach a card' },
  addContention: {
    label: 'Add contention',
  },
  addResponse: {
    label: 'Add a response',
  },
  addToCase: {
    label: 'Add to case',
  },
  saveBrief: { label: 'Save changes' },
  shareCase: { label: 'Share' },
  addBlock: { label: 'Add to speech' },
  saveVersion: { label: 'Save version' },
  restoreVersion: {
    label: 'Restore as a new version',
  },
  exportPdf: { label: 'Export PDF' },
  print: { label: 'Print' },
  copyText: { label: 'Copy as text' },
  stopSharing: {
    label: 'Stop sharing',
  },
  addGrant: { label: 'Add' },
  comment: { label: 'Comment' },
  reply: { label: 'Reply' },
  resolve: { label: 'Resolve' },
  invite: { label: 'Invite' },
  sendInvite: { label: 'Send invite' },
  manageMember: { label: 'Manage' },
  leaveTeam: { label: 'Leave team' },
  sendCard: {
    label: 'Send card',
  },
  copyCiteInRoom: {
    label: 'Copy cite',
  },
  deleteCard: { label: 'Delete card' },
} as const satisfies Record<string, InertAction>;
