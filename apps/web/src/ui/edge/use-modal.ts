'use client';

import { useLayoutEffect, type RefObject } from 'react';

/**
 * Shows the native dialog a ref holds as a modal while `open`, and closes
 * it when `open` turns false, before the browser paints.
 */
export function useModal(
  dialog: RefObject<HTMLDialogElement | null>,
  open: boolean,
): void {
  useLayoutEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (open && !node.open) node.showModal();
    if (!open && node.open) node.close();
  }, [dialog, open]);
}
