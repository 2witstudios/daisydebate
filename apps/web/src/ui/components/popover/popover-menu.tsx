'use client';

import type { ComponentPropsWithRef } from 'react';
import {
  popoverClasses,
  type PopoverClassName,
  type PopoverLayout,
} from './popover-classes';

export type PopoverMenuProps<C extends string> = Omit<
  ComponentPropsWithRef<'div'>,
  'popover' | 'role' | 'className'
> & {
  /** How the open menu lays out its items; closed, it is hidden. */
  readonly layout?: PopoverLayout | undefined;
  /** Surface and placement classes only: the menu owns display and direction. */
  readonly className?: (C & PopoverClassName<C>) | undefined;
};

/**
 * A native `popover="auto"` menu (`role="menu"`). Like PopoverDialog it is
 * hidden until open and owns its display (ADR 0153); the caller keeps the
 * menu's own focus and placement behavior.
 */
export function PopoverMenu<C extends string = string>({
  layout,
  className,
  ...props
}: PopoverMenuProps<C>) {
  return (
    <div
      {...props}
      popover="auto"
      role="menu"
      className={popoverClasses({ layout, className })}
    />
  );
}
