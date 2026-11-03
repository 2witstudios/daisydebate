'use client';

import { useState, useSyncExternalStore } from 'react';

const subscribeNever = () => () => undefined;

/** Clipboard copy once hydrated: `ready` is false on the server and with no script. */
export function useClipboardCopy() {
  const ready = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
  const [copied, setCopied] = useState(false);
  const copy = (text: string) => {
    navigator.clipboard
      .writeText(text)
      .then(() => setCopied(true))
      .catch(() => setCopied(false));
  };
  return { ready, copied, copy };
}
