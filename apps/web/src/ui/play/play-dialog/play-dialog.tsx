'use client';

import { useRef, type ReactNode } from 'react';
import { buttonClass } from '../../components/button/button-class';
import { Icon } from '../../components/icon/icon';

/** The page that lists the same choices when no script has run. */
const playFallbackHref = '/play';

const closeClass =
  'flex size-nav-target shrink-0 cursor-pointer items-center justify-center rounded-round text-ink-muted hover:bg-surface-overlay hover:text-ink';

/**
 * Play over the Lobby: a link to `/play` that, once hydrated, opens the same
 * choices in a modal dialog instead. Escape, the close button and "Just
 * browse the Lobby" all close it where it opened.
 */
export function PlayDialog({ children }: { readonly children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <>
      <a
        href={playFallbackHref}
        aria-haspopup="dialog"
        onClick={(event) => {
          event.preventDefault();
          dialog.current?.showModal();
        }}
        className={buttonClass('secondary')}
      >
        Play
      </a>
      <dialog
        ref={dialog}
        aria-labelledby="play-dialog-title"
        className="m-auto w-play-dialog max-w-full flex-col gap-4 rounded-lg border border-border-strong bg-surface-raised p-6 text-ink shadow-3 backdrop:bg-scrim/50 open:flex max-narrow:p-4"
      >
        <form
          method="dialog"
          className="flex items-start justify-between gap-4"
        >
          <h2
            id="play-dialog-title"
            className="font-display text-2xl font-bold"
          >
            Play
          </h2>
          <button type="submit" aria-label="Close" className={closeClass}>
            <Icon name="close" size={18} />
          </button>
        </form>
        {children}
        <form method="dialog" className="flex justify-center">
          <button type="submit" className={buttonClass('ghost')}>
            Just browse the Lobby
          </button>
        </form>
      </dialog>
    </>
  );
}
