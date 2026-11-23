'use client';

import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  type RefObject,
} from 'react';

/** The name of the request a page makes to open a dialog it does not own. */
export const dialogRequestEvent = 'daisy:dialog-requested';

export type DialogLifetime = {
  readonly open: boolean;
  readonly modal: boolean;
  readonly onClose: () => void;
  /** Takes focus when the dialog opens; otherwise the platform's first control. */
  readonly initialFocus?: RefObject<HTMLElement | null> | undefined;
  /** Takes focus back on closing, in place of whatever opened the dialog. */
  readonly returnFocus?: RefObject<HTMLElement | null> | undefined;
  /** Asks the owner to open: another part of the page requested this dialog. */
  readonly onOpenRequested?: (() => void) | undefined;
};

const focusLostOrInside = (dialog: HTMLDialogElement) => {
  const active = document.activeElement;
  return (
    active === null ||
    active === document.body ||
    !active.isConnected ||
    dialog.contains(active)
  );
};

/**
 * A native dialog's whole lifetime: shown (as a modal, or in place) while
 * `open`, closed when it turns false, `onClose` told of every close the
 * member makes (Escape, a `method="dialog"` form), focus taken on opening
 * and handed back to the control that opened it on closing or leaving.
 */
export function useModal(
  dialog: RefObject<HTMLDialogElement | null>,
  {
    open,
    modal,
    onClose,
    initialFocus,
    returnFocus,
    onOpenRequested,
  }: DialogLifetime,
): void {
  const opener = useRef<HTMLElement | null>(null);
  const shown = useRef(false);
  const close = useEffectEvent(onClose);
  const requested = useEffectEvent(() => onOpenRequested?.());
  const giveBack = useEffectEvent(() => {
    const node = dialog.current;
    const back = returnFocus?.current ?? opener.current;
    opener.current = null;
    if (back !== null && back !== document.body && back.isConnected)
      if (node === null || focusLostOrInside(node)) back.focus();
  });
  useLayoutEffect(() => {
    const node = dialog.current;
    if (node === null) return;
    if (open && !shown.current) {
      shown.current = true;
      opener.current = document.activeElement as HTMLElement | null;
      if (modal && !node.open) node.showModal();
      initialFocus?.current?.focus();
    } else if (!open && shown.current) {
      shown.current = false;
      if (modal && node.open) node.close();
      giveBack();
    }
  }, [dialog, open, modal, initialFocus]);
  useLayoutEffect(
    () => () => {
      if (shown.current) giveBack();
    },
    [],
  );
  useEffect(() => {
    const node = dialog.current;
    if (node === null) return;
    // A modal closes itself (Escape, a dialog form); tell the owner.
    const closed = () => {
      if (shown.current) close();
    };
    // An in-place dialog has no platform Escape.
    const escape = (event: KeyboardEvent) => {
      if (modal || event.key !== 'Escape' || !shown.current) return;
      event.preventDefault();
      close();
    };
    const asked = (event: Event) => {
      const label = node.getAttribute('aria-labelledby');
      if (label !== null && (event as CustomEvent<unknown>).detail === label)
        requested();
    };
    node.addEventListener('close', closed);
    node.addEventListener('keydown', escape);
    document.addEventListener(dialogRequestEvent, asked);
    return () => {
      node.removeEventListener('close', closed);
      node.removeEventListener('keydown', escape);
      document.removeEventListener(dialogRequestEvent, asked);
    };
  }, [dialog, modal]);
}
