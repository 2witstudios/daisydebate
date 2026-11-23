'use client';

import { useDeliver } from '../edge/use-answer';
import { useWait } from '../edge/use-tick';
import { useCallback, useMemo, useRef, useState } from 'react';
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
  const wait = useWait();
  const refresh = useCallback(() => {
    if (!enabled) return;
    generation.current++;
    const read = () => {
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
      wait.cancel();
      read();
    } else if (!wait.armed()) wait.arm(read, waitMs);
  }, [enabled, wait]);
  // The frame's save settling refreshes Recent; a seeded list skips the first.
  const settled = useMemo(() => ({ refresh, save }), [refresh, save]);
  useDeliver(settled, (next) => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (next.save === undefined || next.save === 'saved') next.refresh();
  });
  return { documents, refresh };
}
