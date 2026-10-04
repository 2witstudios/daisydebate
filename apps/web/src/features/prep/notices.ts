/**
 * The alerts Prep raises in context: import problems, an incomplete
 * citation, a save conflict, a refused share and the two card-deletion
 * cases. Copy lives here as pure data; an action with an `href` navigates
 * and one without is inert until the Prep service exists.
 */
export type NoticeTone = 'danger' | 'warning' | 'info';

export type NoticeAction = {
  readonly label: string;
  readonly variant: 'primary' | 'secondary' | 'ghost' | 'danger';
  readonly symbol?: 'refresh' | 'upload';
  readonly href?: string;
};

export type Notice = {
  readonly tone: NoticeTone;
  readonly title: string;
  readonly body: string;
  readonly actions: readonly NoticeAction[];
};

const secondary = (label: string, href?: string): NoticeAction =>
  href === undefined
    ? { label, variant: 'secondary' }
    : { label, variant: 'secondary', href };

export const importUnreachable = (
  retryHref: string,
  pasteHref: string,
): Notice => ({
  tone: 'danger',
  title: 'We could not open that page',
  body: 'The site did not answer.',
  actions: [
    {
      label: 'Try again',
      variant: 'secondary',
      symbol: 'refresh',
      href: retryHref,
    },
    secondary('Paste text instead', pasteHref),
  ],
});

export const importLoginWall = (
  words: number,
  pasteHref: string,
  fileHref: string,
): Notice => ({
  tone: 'warning',
  title: 'This page asks for a login',
  body: `We only saw the first ${words} words.`,
  actions: [
    secondary('Paste text', pasteHref),
    {
      label: 'Upload a PDF',
      variant: 'secondary',
      symbol: 'upload',
      href: fileHref,
    },
  ],
});

export const importScanPdf = (chooseHref: string): Notice => ({
  tone: 'warning',
  title: 'This PDF is a scan with no selectable text',
  body: 'Text recognition takes about a minute.',
  actions: [
    secondary('Run text recognition'),
    secondary('Choose another', chooseHref),
  ],
});

export const importDuplicate = (
  cardHref: string,
  cardTitle: string,
  savedOn: string,
  newCardHref: string,
): Notice => ({
  tone: 'info',
  title: 'You already have a card from this source',
  body: `Saved as “${cardTitle}” on ${savedOn}.`,
  actions: [
    secondary('Open that card', cardHref),
    secondary('Save a new card anyway', newCardHref),
  ],
});

export const citationIncomplete = (missing: string): Notice => ({
  tone: 'warning',
  title: `The ${missing} is missing`,
  body: 'You can still save it.',
  actions: [secondary('Add it', '#citation'), secondary('Save anyway')],
});

export const saveConflict = (when: string): Notice => ({
  tone: 'danger',
  title: `This brief was edited on another device at ${when}`,
  body: 'Your changes are kept here and were not saved over theirs.',
  actions: [
    secondary('Compare'),
    secondary('Keep mine'),
    secondary('Use theirs'),
  ],
});

export const shareNotAllowed = (
  teamName: string,
  chooseHref: string,
  keepHref: string,
): Notice => ({
  tone: 'danger',
  title: 'Only team members can be given access',
  body: `Ask a ${teamName} admin to invite you.`,
  actions: [
    secondary('Choose another team', chooseHref),
    secondary('Keep private', keepHref),
  ],
});

export const cardDeletedInCase = (): Notice => ({
  tone: 'warning',
  title: 'A card in this case was deleted',
  body: 'Its slot is kept.',
  actions: [secondary('Replace card'), secondary('Remove slot')],
});

export const deleteInUse = (uses: number, keepHref: string): Notice => ({
  tone: 'danger',
  title: `This card is used in ${uses} ${uses === 1 ? 'place' : 'places'}`,
  body: 'This cannot be undone.',
  actions: [
    { label: 'Delete card', variant: 'danger' },
    secondary('Keep card', keepHref),
  ],
});

export const caseChangedElsewhere = (
  pinned: number,
  latest: number,
  switchHref: string,
  keepHref: string,
): Notice => ({
  tone: 'info',
  title: 'This case changed elsewhere',
  body: `You saved v${latest} on another device.`,
  actions: [
    secondary(`Switch to v${latest}`, switchHref),
    { label: `Keep v${pinned}`, variant: 'ghost', href: keepHref },
  ],
});
