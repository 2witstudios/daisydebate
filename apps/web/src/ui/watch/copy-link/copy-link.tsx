'use client';

import { useState, useSyncExternalStore } from 'react';
import { buttonClass } from '../../components/button/button-class';

const subscribeNever = () => () => undefined;

export type CopyLinkProps = {
  /** The path to share; the browser adds its own origin. */
  readonly path: string;
};

/**
 * Share a link. With no script the link is a readonly field inside a native
 * `<details>` to select and copy by hand; once hydrated a Copy button writes
 * it to the clipboard.
 */
export function CopyLink({ path }: CopyLinkProps) {
  const ready = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard
      .writeText(`${window.location.origin}${path}`)
      .then(() => setCopied(true))
      .catch(() => setCopied(false));
  };
  return (
    <details className="relative">
      <summary className={`${buttonClass('secondary')} list-none`}>
        {copied ? 'Link copied' : 'Copy link'}
      </summary>
      <div className="absolute right-0 z-10 mt-2 flex w-rail items-center gap-2 rounded-md border border-border bg-surface-raised p-2 shadow-2">
        <input
          readOnly
          value={path}
          aria-label="Link to this page"
          className="h-10 min-w-0 flex-1 rounded-sm border border-border bg-surface px-2 text-sm text-ink"
        />
        {ready ? (
          <button
            type="button"
            onClick={copy}
            className={buttonClass('primary')}
          >
            Copy
          </button>
        ) : null}
      </div>
    </details>
  );
}
