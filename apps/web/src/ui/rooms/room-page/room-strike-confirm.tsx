'use client';

import { useState } from 'react';
import { buttonClass } from '../../components/button/button-class';

/**
 * What a press does, given the position the prompt names (null before the
 * first press) and the position chosen now: ask about it, or let the
 * native post go. The post only ever strikes the position the prompt named.
 */
export function strikePress(
  confirming: string | null,
  chosen: string | null,
):
  | { readonly kind: 'post' }
  | { readonly kind: 'ask'; readonly position: string } {
  if (chosen === null || chosen === confirming) return { kind: 'post' };
  return { kind: 'ask', position: chosen };
}

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
  // The position the prompt names: the post must strike exactly this one.
  const [confirming, setConfirming] = useState<string | null>(null);
  const chosenIn = (form: HTMLFormElement | null) => {
    const chosen = new FormData(form ?? undefined).get('position');
    return typeof chosen === 'string' ? chosen : null;
  };
  if (confirming !== null)
    return (
      <div className="flex flex-col gap-2" role="group" aria-live="polite">
        <p className="text-sm font-semibold">
          Strike ‘{texts[confirming] ?? ''}’? You can’t undo a strike.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            className={buttonClass('primary')}
            // The prompt's own button takes focus as it appears.
            autoFocus
            onClick={(event) => {
              const press = strikePress(
                confirming,
                chosenIn(event.currentTarget.form),
              );
              if (press.kind === 'post') return;
              event.preventDefault();
              setConfirming(press.position);
            }}
          >
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
          // Nothing chosen: the native required check speaks.
          const press = strikePress(null, chosenIn(event.currentTarget.form));
          if (press.kind === 'post') return;
          event.preventDefault();
          setConfirming(press.position);
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
