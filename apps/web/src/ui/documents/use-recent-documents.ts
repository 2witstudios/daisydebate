'use client';

import { useBrowserEffect } from '../edge/browser-sync';
import { cancelDelay, delay } from '../edge/browser-time';
import { useCallback, useRef, useState } from 'react';
import { nowMs, systemClock } from '@daisy/clock';
import { driveApi, type RecentDocument } from './drive-api';
import type { SaveState } from './document-pane';

// At most 20 sidebar requests per minute leaves room in the shared Recent
// bucket for sync.load and another tab. The final save always gets a refresh.
const REFRESH_INTERVAL_MS = 3_000;

/** A bounded, ordered read of Recent; a failed refresh keeps the last good list. */
export function useRecentDocuments(
  enabled: boolean,
  save: SaveState | undefined,
  initial?: readonly RecentDocument[],
) {
  const [documents, setDocuments] = useState<readonly RecentDocument[]>(
    initial ?? [],
  );
  const generation = useRef(0);
  const first = useRef(initial !== undefined);
  const lastStarted = useRef(-Infinity);
  const timer = useRef<ReturnType<typeof delay> | null>(null);
  const refresh = useCallback(() => {
    if (!enabled) return;
    generation.current++;
    const read = () => {
      timer.current = null;
      lastStarted.current = nowMs(systemClock);
      const requested = generation.current;
      driveApi.recent().then(
        (found) => {
          if (requested === generation.current) setDocuments(found);
        },
        () => {},
      );
    };
    const waitMs = Math.max(
      0,
      REFRESH_INTERVAL_MS - (nowMs(systemClock) - lastStarted.current),
    );
    if (waitMs === 0) {
      if (timer.current !== null) cancelDelay(timer.current);
      read();
    } else if (timer.current === null) timer.current = delay(read, waitMs);
  }, [enabled]);
  useBrowserEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (save === undefined || save === 'saved') refresh();
  }, [refresh, save]);
  useBrowserEffect(
    () => () => {
      generation.current++;
      if (timer.current !== null) cancelDelay(timer.current);
    },
    [],
  );
  return { documents, refresh };
}
