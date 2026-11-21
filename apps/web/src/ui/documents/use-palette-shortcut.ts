'use client';

import { useDocumentEvent } from '../edge/use-browser-bindings';
import { type Dispatch } from 'react';
import type { ManagerAction } from '../../features/documents/document-manager-state';

/** Opens the document palette from either persisted or active Round workspaces. */
export function usePaletteShortcut(dispatch: Dispatch<ManagerAction>) {
  useDocumentEvent('keydown', (event) => {
    if (event.key.toLowerCase() !== 'k' || !(event.metaKey || event.ctrlKey))
      return;
    event.preventDefault();
    dispatch({ type: 'palette/open', mode: 'search' });
  });
}
