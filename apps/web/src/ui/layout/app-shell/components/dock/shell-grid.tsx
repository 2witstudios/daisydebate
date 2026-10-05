'use client';

import type { ReactNode } from 'react';
import { useUiState } from '../../../../store/store';

/**
 * The shell's grid. It carries the sidebar's state as `data-nav` and the
 * social rail's as `data-dock`, which the layout reads: the rail's column
 * is a strip of icons, or the open panel on a wide screen. A visitor has no
 * rail (`none`), so no column is reserved for it.
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
      data-dock={hasDock ? dock : 'none'}
      data-nav={nav}
      className="grid min-h-screen grid-shell items-start"
    >
      {children}
    </div>
  );
}
