'use client';
import { useCallback } from 'react';
import type { RoundView } from '@daisy/protocol/round-view';
import type { RoundRead } from '../../features/round-runtime/read-round';
import { browserSyncEdges } from '../resource-sync/browser';
import {
  createRoundSyncDriver,
  seedRoundSync,
} from '../../features/round-runtime/round-sync-driver';
import { useDriver } from '../edge/use-driver';

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
  return useDriver(() => seedRoundSync(view, 0), start);
}
