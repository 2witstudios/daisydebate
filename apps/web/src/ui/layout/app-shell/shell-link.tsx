'use client';

import Link from 'next/link';
import type { ComponentProps } from 'react';
import {
  acceptShellNavigation,
  shellNavigationEvent,
} from './shell-navigation';

/** Also used immediately before the shell's explicit programmatic dispatch. */
export const announceShellNavigation = () => {
  document.dispatchEvent(new Event(shellNavigationEvent));
};

/** Preserve Link's props and announce its accepted same-tab choice before dispatch. */
export function ShellLink({
  onNavigate,
  ...props
}: ComponentProps<typeof Link>) {
  return (
    <Link
      {...props}
      onNavigate={(event) =>
        acceptShellNavigation(event, onNavigate, announceShellNavigation)
      }
    />
  );
}
