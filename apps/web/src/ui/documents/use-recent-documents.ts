'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { systemClock } from '@daisy/clock';
import { driveApi, type RecentDocument } from './drive-api';
import type { SaveState } from './document-pane';

// At most 20 sidebar requests per minute leaves room in the shared Recent
// bucket for sync.load and another tab. The final save always gets a refresh.
const REFRESH_INTERVAL_MS = 3_000;

/** A bounded, ordered read of Recent; a failed refresh keeps the last good list. */
export function useRecentDocuments(
  enabled: boolean,
  save: SaveState | undefined,
) {
  const [documents, setDocuments] = useState<readonly RecentDocument[]>([]);
  const generation = useRef(0);
  const lastStarted = useRef(-Infinity);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refresh = useCallback(() => {
    if (!enabled) return;
    generation.current++;
    const read = () => {
      timer.current = null;
      lastStarted.current = Date.parse(systemClock.now());
      const requested = generation.current;
      driveApi.recent().then(
        (found) => {
          if (requested === generation.current) setDocuments(found);
        },
        () => {},
      );
    };
    const delay = Math.max(
      0,
      REFRESH_INTERVAL_MS -
        (Date.parse(systemClock.now()) - lastStarted.current),
    );
    if (delay === 0) {
      if (timer.current !== null) clearTimeout(timer.current);
      read();
    } else if (timer.current === null) timer.current = setTimeout(read, delay);
  }, [enabled]);
  useEffect(() => {
    if (save === undefined || save === 'saved') refresh();
  }, [refresh, save]);
  useEffect(
    () => () => {
      generation.current++;
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  return { documents, refresh };
}
