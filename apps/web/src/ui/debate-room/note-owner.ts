import type { DocumentSync } from './document-sync';
type NoteOwner = { readonly sync: DocumentSync; readonly principalId: string };

/** Strict Mode reattaches one owner; an account replacement ends private ownership. */
const noteOwnerExit = (
  previous: NoteOwner,
  next: NoteOwner,
): 'reattached' | 'purge' | 'flush' => {
  if (previous.principalId !== next.principalId) return 'purge';
  return previous !== next && previous.sync === next.sync
    ? 'reattached'
    : 'flush';
};

/** The browser cleanup calls this with the latest observed owner token. */
export async function releaseNoteOwner(previous: NoteOwner, next: NoteOwner) {
  const mode = noteOwnerExit(previous, next);
  if (mode === 'reattached') return;
  if (mode === 'purge') {
    previous.sync.dispose({ purge: true });
    return;
  }
  try {
    await previous.sync.flush();
  } finally {
    previous.sync.dispose();
  }
}
