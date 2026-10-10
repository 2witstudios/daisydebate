'use client';

import { useEffect, type Dispatch } from 'react';
import type { RoomAction } from './room-state';

/** Opens the document palette from either persisted or active Round workspaces. */
export function usePaletteShortcut(dispatch: Dispatch<RoomAction>) {
  useEffect(() => {
    const open = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'k' || !(event.metaKey || event.ctrlKey))
        return;
      event.preventDefault();
      dispatch({ type: 'palette/open' });
    };
    document.addEventListener('keydown', open);
    return () => document.removeEventListener('keydown', open);
  }, [dispatch]);
}
