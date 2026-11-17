'use client';

import type { ComponentPropsWithoutRef } from 'react';

const focusable =
  'select, input:not([type="hidden"]), textarea, button:not([disabled])';

/**
 * A native `popover="auto"` dialog that opens without script. When it opens,
 * focus moves to the element marked `data-initial-focus`, else its first
 * control; closing returns focus to the opener natively.
 */
export function PopoverDialog(
  props: Omit<ComponentPropsWithoutRef<'div'>, 'popover' | 'role'>,
) {
  return (
    <div
      {...props}
      popover="auto"
      role="dialog"
      onToggle={(event) => {
        props.onToggle?.(event);
        const dialog = event.currentTarget;
        if (!dialog.matches(':popover-open')) return;
        (
          dialog.querySelector<HTMLElement>('[data-initial-focus]') ??
          dialog.querySelector<HTMLElement>(focusable)
        )?.focus();
      }}
    />
  );
}
