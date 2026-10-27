'use client';

import { useState } from 'react';
import { buttonClass } from '../../components/button/button-class';

/**
 * The strike's submit. Without JavaScript the button is the confirmation;
 * with it, the first press names the chosen resolution and asks once more,
 * because a strike can't be undone (FMT-7.2).
 */
export function StrikeSubmit({
  texts,
}: {
  readonly texts: Readonly<Record<string, string>>;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);
  if (confirming !== null)
    return (
      <div className="flex flex-col gap-2" role="group" aria-live="polite">
        <p className="text-sm font-semibold">
          Strike ‘{confirming}’? You can’t undo a strike.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className={buttonClass('primary')}>
            Strike it
          </button>
          <button
            type="button"
            className={buttonClass('secondary')}
            onClick={() => setConfirming(null)}
          >
            Keep choosing
          </button>
        </div>
      </div>
    );
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="submit"
        className={buttonClass('primary')}
        onClick={(event) => {
          const chosen = new FormData(
            event.currentTarget.form ?? undefined,
          ).get('position');
          // Nothing chosen: let the native required check speak.
          if (typeof chosen !== 'string') return;
          event.preventDefault();
          setConfirming(texts[chosen] ?? '');
        }}
      >
        Strike this resolution
      </button>
      <span className="text-sm text-ink-muted">
        A strike can’t be undone. If time runs out, Daisy strikes for you.
      </span>
    </div>
  );
}
