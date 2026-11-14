import type { ShownEntrant } from '@daisy/protocol/lobby/posting-read';

/** An entrant as the viewer may see them: their name, or their initials. */
export const shownName = (shown: ShownEntrant): string =>
  shown.kind === 'name' ? shown.name : shown.initials;
