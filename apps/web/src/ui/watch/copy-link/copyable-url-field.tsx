'use client';

import { Button } from '../../components/button/button';
import { useClipboardCopy } from './use-clipboard-copy';

/** An address to pass on: selectable by hand always, with a Copy button once hydrated. */
export function CopyableUrlField({
  url,
  label,
}: {
  readonly url: string;
  readonly label: string;
}) {
  const { ready, copied, copy } = useClipboardCopy();
  return (
    <div className="flex items-center gap-2">
      <input
        readOnly
        value={url}
        aria-label={label}
        className="h-10 min-w-0 flex-1 rounded-sm border border-border bg-surface-raised px-2 text-sm text-ink"
      />
      {ready ? (
        <Button variant="secondary" type="button" onClick={() => copy(url)}>
          {copied ? 'Copied' : 'Copy'}
        </Button>
      ) : null}
    </div>
  );
}
