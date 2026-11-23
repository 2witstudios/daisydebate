'use client';

import { Button } from '../../components/button/button';
import { Dialog } from '../../components/dialog/dialog';
import { useState, type ReactNode } from 'react';

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
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="secondary"
        type="button"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        {label}
      </Button>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
          onClose?.();
        }}
        onOpenRequested={() => setOpen(true)}
        aria-labelledby={titleId}
        className="m-auto w-room-dialog max-w-full flex-col gap-4 rounded-lg border border-border-strong bg-surface p-6 text-ink shadow-3 backdrop:bg-scrim/50 open:flex"
      >
        <h2 id={titleId} className="font-display text-lg">
          {title}
        </h2>
        {children}
      </Dialog>
    </>
  );
}

/** The button that closes the `RoomDialog` it is in, changing nothing. */
export function RoomDialogClose({ children }: { readonly children: string }) {
  return (
    <form method="dialog">
      <Button variant="secondary" type="submit">
        {children}
      </Button>
    </form>
  );
}
