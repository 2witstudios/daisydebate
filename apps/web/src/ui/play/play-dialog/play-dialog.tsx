'use client';

import { Dialog } from '../../components/dialog/dialog';
import { Button } from '../../components/button/button';
import { useState, type ReactNode } from 'react';
import { buttonClass } from '../../components/button/button-class';
import { Icon } from '../../components/icon/icon';

/** The page that lists the same choices when nothing has hydrated. */
const playFallbackHref = '/play';

type Click = {
  readonly button: number;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
};

/** A plain primary click opens the dialog; a modified one keeps the link's own tab or window. */
export const opensInPlace = (click: Click): boolean =>
  click.button === 0 &&
  !click.metaKey &&
  !click.ctrlKey &&
  !click.shiftKey &&
  !click.altKey;

/**
 * Play over the Lobby: a link to `/play` that, once hydrated, opens the same
 * choices in a modal dialog instead. Escape, the close button and "Just
 * browse the Lobby" all close it where it opened.
 */
export function PlayDialog({ children }: { readonly children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <a
        href={playFallbackHref}
        aria-haspopup="dialog"
        onClick={(event) => {
          if (!opensInPlace(event)) return;
          event.preventDefault();
          setOpen(true);
        }}
        className={buttonClass('secondary')}
      >
        Play
      </a>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
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
          <Button variant="icon" type="submit" aria-label="Close" size="nav">
            <Icon name="close" size={18} />
          </Button>
        </form>
        {children}
        <form method="dialog" className="flex justify-center">
          <Button variant="ghost" type="submit">
            Just browse the Lobby
          </Button>
        </form>
      </Dialog>
    </>
  );
}
