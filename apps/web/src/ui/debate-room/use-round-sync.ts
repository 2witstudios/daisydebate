'use client';

import { useMemo, useState } from 'react';
import type { SaveState } from './document-pane';
import { createDocumentsApi } from './documents-api';
import { createDocumentSync, type DocumentSync } from './document-sync';
import { refusedNotice, RETRYING_NOTICE } from './save-notice';

/**
 * A participant's files on the persisted Round's document API, with what
 * the room says about saving: the standing notice and the saved state.
 */
export function useRoundSync(roundId: string): {
  readonly sync: DocumentSync;
  readonly notice: string | null;
  readonly save: SaveState;
} {
  const [notice, setNotice] = useState<string | null>(null);
  const [save, setSave] = useState<SaveState>('saved');
  const sync = useMemo(() => {
    const stored = createDocumentSync({
      roundId,
      api: createDocumentsApi(),
      onConflict: () => {
        setSave('unsaved');
        setNotice(
          'This file changed in another tab. Reload before editing it again.',
        );
      },
      onSaveFailed: () => {
        setSave('unsaved');
        setNotice(RETRYING_NOTICE);
      },
      onSaveRefused: (_id, status) => {
        setSave('unsaved');
        setNotice(refusedNotice(status));
      },
      onSaved: () => {
        setSave('saved');
        setNotice(null);
      },
    });
    return {
      ...stored,
      change: (id: string, html: string) => {
        setSave('saving');
        stored.change(id, html);
      },
    };
  }, [roundId]);
  return { sync, notice, save };
}
