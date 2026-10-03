'use client';

import { useSyncExternalStore } from 'react';
import { useUiState, useUiStore } from '../../../../store/store';
import type { DockState } from '../../../../store/state';
import { dispatch, transactions } from '../../../../transactions';
import { dockOpen, wideQuery } from './dock-state';

const subscribeWide = (onChange: () => void): (() => void) => {
  const query = matchMedia(wideQuery);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};

/**
 * The friends dock's state for a control: whether it is open right now (a
 * choice wins, otherwise the screen width decides) and a way to change it.
 * The server renders it as on a wide screen; the browser corrects that.
 */
export function useDock(): {
  readonly open: boolean;
  readonly setDock: (dock: DockState) => void;
} {
  const store = useUiStore();
  const dock = useUiState((state) => state.resources.dock);
  const wide = useSyncExternalStore(
    subscribeWide,
    () => matchMedia(wideQuery).matches,
    () => true,
  );
  return {
    open: dockOpen(dock, wide),
    setDock: (next) => dispatch(store, transactions.setDock, next),
  };
}
