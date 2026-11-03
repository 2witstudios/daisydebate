'use client';

import { buttonClass } from '../../components/button/button-class';
import { useClipboardCopy } from '../../watch/copy-link/use-clipboard-copy';

/** The feed address: selectable by hand always, with a Copy button once hydrated. */
export function FeedUrlField({ feedUrl }: { readonly feedUrl: string }) {
  const { ready, copied, copy } = useClipboardCopy();
  return (
    <div className="flex items-center gap-2">
      <input
        readOnly
        value={feedUrl}
        aria-label="Official feed URL"
        className="h-10 min-w-0 flex-1 rounded-sm border border-border bg-surface-raised px-2 text-sm text-ink"
      />
      {ready ? (
        <button
          type="button"
          onClick={() => copy(feedUrl)}
          className={buttonClass('secondary')}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      ) : null}
    </div>
  );
}
