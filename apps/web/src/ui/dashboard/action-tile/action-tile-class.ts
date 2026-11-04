export type NoteColor = 'action' | 'yellow' | 'sage';

export type NoteTilt = 'left' | 'slight-left' | 'slight-right' | 'right';

const notePaper: Readonly<Record<NoteColor, string>> = {
  action: 'note-paper-action text-accent-ink',
  yellow: 'note-paper-yellow max-narrow:note-paper-menu text-note-ink',
  sage: 'note-paper-sage max-narrow:note-paper-menu text-note-ink',
};

const noteCopy: Readonly<Record<NoteColor, string>> = {
  action: 'text-accent-ink',
  yellow: 'text-note-ink-muted',
  sage: 'text-note-ink-muted',
};

const noteTilts: Readonly<Record<NoteTilt, string>> = {
  left: 'note-tilt-left',
  'slight-left': 'note-tilt-slight-left',
  'slight-right': 'note-tilt-slight-right',
  right: 'note-tilt-right',
};

/** The paper and ink of a note. */
export const notePaperClass = (color: NoteColor): string => notePaper[color];

/** The ink of a note's tagline; on the emphasised note it stays full strength. */
export const noteCopyClass = (color: NoteColor): string => noteCopy[color];

/** How far a note leans on the page. */
export const noteTiltClass = (tilt: NoteTilt): string => noteTilts[tilt];
