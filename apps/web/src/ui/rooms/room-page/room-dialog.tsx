'use client';

import { useRef, type ReactNode } from 'react';
import { buttonClass } from '../../components/button/button-class';

/**
 * A header button that opens a modal dialog over the pre-round Room: the
 * button says it opens one, the dialog is named by its title, and Esc
 * closes it. Its own way out (Cancel, Done) is a `RoomDialogClose` among
 * its children; `onClose` hears every close, Esc included.
 */
export function RoomDialog({
  label,
  titleId,
  title,
  onClose,
  children,
}: {
  readonly label: ReactNode;
  readonly titleId: string;
  readonly title: string;
  readonly onClose?: () => void;
  readonly children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => dialog.current?.showModal()}
        className={buttonClass('secondary')}
      >
        {label}
      </button>
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        onClose={onClose}
        className="m-auto w-room-dialog max-w-full flex-col gap-4 rounded-lg border border-border-strong bg-surface p-6 text-ink shadow-3 backdrop:bg-scrim/50 open:flex"
      >
        <h2 id={titleId} className="font-display text-lg">
          {title}
        </h2>
        {children}
      </dialog>
    </>
  );
}

/** The button that closes the `RoomDialog` it is in, changing nothing. */
export function RoomDialogClose({ children }: { readonly children: string }) {
  return (
    <form method="dialog">
      <button type="submit" className={buttonClass('secondary')}>
        {children}
      </button>
    </form>
  );
}
