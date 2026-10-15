'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Icon } from '../components/icon/icon';

export type LeaveLinks = {
  /** The server rendered the confirm (no script ran yet). */
  readonly confirming: boolean;
  /** This round without the confirm: where Stay goes. */
  readonly stayHref: string;
  /** This round with the confirm: where Leave room goes without script. */
  readonly confirmHref: string;
  /** Where leaving takes the debater. */
  readonly leaveHref: string;
};

const action =
  'inline-flex h-room-target cursor-pointer items-center justify-center rounded-sm px-4 text-sm font-strong';

/**
 * Leave, far right of the round bar, behind a confirm. Leaving changes
 * nothing on the server, so every step is a link and works without script;
 * with script the confirm opens in place.
 */
export function LeaveRoom({ links }: { readonly links: LeaveLinks }) {
  const [open, setOpen] = useState(links.confirming);
  const stay = useRef<HTMLAnchorElement>(null);
  const trigger = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (open) stay.current?.focus();
  }, [open]);
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  const key = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    close();
  };
  return (
    <>
      <a
        ref={trigger}
        href={links.confirmHref}
        aria-label="Leave room"
        aria-haspopup="dialog"
        onClick={(event) => {
          event.preventDefault();
          setOpen(true);
        }}
        className="ml-2 flex size-room-target shrink-0 items-center justify-center rounded-round border border-live text-live"
      >
        <Icon name="leave" size={18} />
      </a>
      <dialog
        open={open}
        aria-labelledby="leave-room-title"
        onKeyDown={key}
        className="fixed inset-0 z-50 m-auto flex w-room-dialog max-w-full flex-col gap-4 rounded-lg border border-border-strong bg-surface p-6 text-ink shadow-3 not-open:hidden"
      >
        <h2 id="leave-room-title" className="font-display text-lg">
          Leave the round?
        </h2>
        <div className="flex justify-end gap-2">
          <a
            ref={stay}
            href={links.stayHref}
            onClick={(event) => {
              event.preventDefault();
              close();
            }}
            className={`${action} border border-border-strong text-ink`}
          >
            Stay
          </a>
          <a
            href={links.leaveHref}
            className={`${action} bg-live text-background`}
          >
            Leave
          </a>
        </div>
      </dialog>
    </>
  );
}
