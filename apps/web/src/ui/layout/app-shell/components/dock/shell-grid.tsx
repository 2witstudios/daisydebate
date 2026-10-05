'use client';

import type { ReactNode } from 'react';
import { useUiState } from '../../../../store/store';

/**
 * The shell's grid. It carries the social rail's state as `data-dock`, which
 * the layout reads: the rail's column is a strip of icons, or the open panel
 * on a wide screen. A visitor has no rail (`none`): the column is only as
 * wide as their way in.
 */
export function ShellGrid({
  hasDock,
  children,
}: {
  readonly hasDock: boolean;
  readonly children: ReactNode;
}) {
  const dock = useUiState((state) => state.resources.dock);
  return (
    <div
      data-dock={hasDock ? dock : 'none'}
      className="grid min-h-screen grid-shell items-start"
    >
      {children}
    </div>
  );
}
