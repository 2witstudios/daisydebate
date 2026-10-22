'use client';
import { useCallback } from 'react';
import type { RoundView } from '@daisy/protocol';
import type { RoundRead } from '../../features/rooms/read-round';
import { browserSyncEdges } from '../../features/resource-sync/browser';
import {
  createRoundSyncDriver,
  seedRoundSync,
} from '../../features/rooms/round-sync-driver';
import { useResourceSync } from '../resource-sync/use-resource-sync';

/** Both assigned judges and debaters follow the same canonical Round revision stream. */
export function useLiveRoundView({
  view,
  read,
  socketUrl,
  onConnectionOpen,
}: {
  readonly view: RoundView;
  readonly read: () => Promise<RoundRead>;
  readonly socketUrl: string | null;
  readonly onConnectionOpen?: () => void;
}) {
  const start = useCallback(
    () =>
      createRoundSyncDriver({
        seed: seedRoundSync(view, 0),
        read,
        ...browserSyncEdges(socketUrl),
        ...(onConnectionOpen ? { onConnectionOpen } : {}),
      }),
    [view, read, socketUrl, onConnectionOpen],
  );
  return useResourceSync(() => seedRoundSync(view, 0), start);
}
