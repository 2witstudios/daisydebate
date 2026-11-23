'use client';

import { useRef, type ComponentPropsWithoutRef, type RefObject } from 'react';
import { dialogRequestEvent, useModal } from '../../edge/use-modal';

export type DialogProps = {
  /** Whether the dialog is showing. The owner keeps it; the dialog reports closes. */
  readonly open: boolean;
  /** Every close the member makes: Escape, a `method="dialog"` form, the backdrop. */
  readonly onClose: () => void;
  /**
   * A modal (the default) takes the page's top layer and makes the rest
   * inert. An in-place dialog renders `open` itself, so a page answered
   * before hydration already shows it.
   */
  readonly modal?: boolean;
  /** Takes focus on opening; otherwise the platform's first control. */
  readonly initialFocus?: RefObject<HTMLElement | null>;
  /**
   * Takes focus back on closing. Without it focus returns to the control
   * that opened the dialog; give one when the dialog may open with nothing
   * focused (shown on arrival, or opened by a click that focuses nothing).
   */
  readonly returnFocus?: RefObject<HTMLElement | null>;
  /** A press on the backdrop closes a modal. */
  readonly closeOnBackdrop?: boolean;
  /** Another part of the page asked for this dialog (`requestDialog`). */
  readonly onOpenRequested?: () => void;
} & Omit<ComponentPropsWithoutRef<'dialog'>, 'open' | 'onClose'>;

/**
 * The native dialog, owning its lifetime: it shows and closes itself from
 * `open`, tells the owner of every close, and hands focus back to the
 * control that opened it.
 */
export function Dialog({
  open,
  onClose,
  modal = true,
  initialFocus,
  returnFocus,
  closeOnBackdrop = false,
  onOpenRequested,
  onClick,
  ...attributes
}: DialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  useModal(dialog, {
    open,
    modal,
    onClose,
    initialFocus,
    returnFocus,
    onOpenRequested,
  });
  return (
    <dialog
      {...attributes}
      ref={dialog}
      open={modal ? undefined : open}
      onClick={(event) => {
        onClick?.(event);
        if (closeOnBackdrop && event.target === dialog.current) onClose();
      }}
    />
  );
}

/** Asks the dialog labelled by `titleId` to open, wherever on the page it is. */
export const requestDialog = (titleId: string): void => {
  document.dispatchEvent(
    new window.CustomEvent(dialogRequestEvent, { detail: titleId }),
  );
};
