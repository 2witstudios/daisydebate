'use client';

import type { ComponentPropsWithoutRef } from 'react';
import {
  popoverClasses,
  type PopoverClassName,
  type PopoverLayout,
} from './popover-classes';

const focusable =
  'select, input:not([type="hidden"]), textarea, button:not([disabled])';

export type PopoverDialogProps<C extends string> = Omit<
  ComponentPropsWithoutRef<'div'>,
  'popover' | 'role' | 'className'
> & {
  /** How the open dialog lays out its children; closed, it is hidden. */
  readonly layout?: PopoverLayout | undefined;
  /** Surface classes only: the dialog owns display and direction. */
  readonly className?: (C & PopoverClassName<C>) | undefined;
};

/**
 * A native `popover="auto"` dialog that opens without script. It is hidden
 * until open and owns its display (ADR 0153). When it opens, focus moves to
 * the element marked `data-initial-focus`, else its first control; closing
 * returns focus to the opener natively.
 */
export function PopoverDialog<C extends string = string>({
  layout,
  className,
  ...props
}: PopoverDialogProps<C>) {
  return (
    <div
      {...props}
      popover="auto"
      role="dialog"
      className={popoverClasses({ layout, className })}
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
