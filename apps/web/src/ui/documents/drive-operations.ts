import type { DocumentSync } from './document-sync';

/** A manager owner's metadata operations, including their verification and UI effects. */
export const createDriveOperations = (owner: DocumentSync | undefined) => {
  let active = false;
  let creating = false;
  let tail = Promise.resolve();
  const owns = () => active && owner?.available() === true;
  return {
    activate: () => {
      active = true;
    },
    close: () => {
      active = false;
    },
    owns,
    // A parent deletion can overlap a child move, so all metadata choices share
    // this sequence. Body autosaves retain their independent revision handling.
    run: (operation: () => Promise<void>) => {
      const next = tail.then(async () => {
        if (owns()) await operation();
      });
      tail = next.catch(() => {});
      return next;
    },
    beginCreate: () => {
      if (!owns() || creating) return false;
      creating = true;
      return true;
    },
    endCreate: () => {
      creating = false;
    },
  };
};
