'use client';

import type { ReactNode } from 'react';
import { useUiState } from '../../../../store/store';

/**
 * The shell's grid. It carries the sidebar's state as `data-nav` and the
 * dock's as `data-dock`, which the layout reads: a third column for the dock while it is open on a wide
 * screen. With no dock (a visitor) it is always `closed`, so no column is
 * reserved for it.
 */
export function ShellGrid({
  hasDock,
  children,
}: {
  readonly hasDock: boolean;
  readonly children: ReactNode;
}) {
  const dock = useUiState((state) => state.resources.dock);
  const nav = useUiState((state) => state.resources.nav);
  return (
    <div
      data-dock={hasDock ? dock : 'closed'}
      data-nav={nav}
      className="grid min-h-screen grid-shell items-start"
    >
      {children}
    </div>
  );
}
