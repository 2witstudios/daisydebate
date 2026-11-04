import type { DocumentSync } from './document-sync';
type DraftOwner = { readonly sync: DocumentSync; readonly principalId: string };

/** Strict Mode reattaches one owner; an account replacement ends private ownership. */
const draftOwnerExit = (
  previous: DraftOwner,
  next: DraftOwner,
): 'reattached' | 'purge' | 'flush' => {
  if (previous.principalId !== next.principalId) return 'purge';
  return previous !== next && previous.sync === next.sync
    ? 'reattached'
    : 'flush';
};

/** The browser cleanup calls this with the latest observed owner token. */
export async function releaseDraftOwner(
  previous: DraftOwner,
  next: DraftOwner,
) {
  const mode = draftOwnerExit(previous, next);
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
