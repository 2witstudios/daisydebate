'use client';

import './zod-jitless';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import { systemClock, systemId } from '@daisy/clock';
import type { RoundView } from '@daisy/protocol';
import { browserSyncEdges } from '../../features/resource-sync/browser';
import type { RoundRead } from '../../features/rooms/read-round';
import {
  createRoundSyncDriver,
  seedRoundSync,
} from '../../features/rooms/round-sync-driver';
import { FreshnessNotice } from '../resource-sync/freshness-notice';
import { useResourceSync } from '../resource-sync/use-resource-sync';
import type { LeaveLinks } from './leave-room';
import { isLiveDebater, liveRoundOf } from './live-round';
import { DebateRoom } from './room';
import { useRoundSync } from './use-round-sync';
import {
  roundCommandIds,
  type RoundCommandIds,
} from '../../features/round-runtime/command-ids';
import type { RoundFormState } from '../../features/round-runtime/command-form';
import type { FormAction } from '../form-action/form-action';
import { RoundCommandActions } from './round-command-actions';

const nowMs = () => Date.parse(systemClock.now());

/**
 * The browser's clock, read once a second: the clock edge of the live room.
 * It starts from the server's render instant so hydration matches.
 */
function useSecond(renderedAtMs: number): number {
  const [now, setNow] = useState(renderedAtMs);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(nowMs()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

/**
 * The mounted round room: the position derived each second from the
 * round's durable snapshot, the snapshot kept current by round sync from
 * its doorbell and reads, never by re-rendering the route (ADR 0066), and
 * the debater's files saved on the persisted Round. A round this debater no
 * longer debates live leaves for its receipt.
 */
export function LiveRoundRoom({
  view: seed,
  actorId,
  renderedAtMs,
  leave,
  read,
  socketUrl,
  commandAction,
  commandIds: seedIds,
  mediaSlot,
}: {
  readonly view: RoundView;
  readonly commandIds: RoundCommandIds;
  readonly commandAction: FormAction<RoundFormState>;
  readonly mediaSlot?: (view: RoundView) => ReactNode;
  readonly renderedAtMs: number;
  readonly actorId: string;
  readonly leave: LeaveLinks;
  readonly read: () => Promise<RoundRead>;
  /** The realtime endpoint, or null when realtime is not configured. */
  readonly socketUrl: string | null;
}) {
  const start = useCallback(
    () =>
      createRoundSyncDriver({
        seed: seedRoundSync(seed, 0),
        read,
        ...browserSyncEdges(socketUrl),
      }),
    [seed, read, socketUrl],
  );
  const [synced, driver] = useResourceSync(() => seedRoundSync(seed, 0), start);
  const view = synced.value;
  const ids = useMemo(
    () =>
      view.version === seed.version
        ? seedIds
        : roundCommandIds(() => systemId.next()),
    [view.version, seed.version, seedIds],
  );
  const [outcome, setOutcome] = useState<string | null>(null);
  const onAnswer = useCallback(
    (answer: RoundFormState) => {
      setOutcome(answer.error ?? 'Command accepted');
      if (answer.view) driver?.accepted(answer.view);
      else if (answer.error) driver?.signal();
    },
    [driver],
  );
  const router = useRouter();
  const ended = !isLiveDebater(view, actorId);
  useEffect(() => {
    if (ended) router.replace(`/rounds/${view.id}`);
  }, [ended, router, view.id]);
  const now = useSecond(renderedAtMs);
  const round = useMemo(
    () => liveRoundOf(view, actorId, now),
    [view, actorId, now],
  );
  const { sync, notice, save } = useRoundSync(view.id);
  return (
    <>
      <FreshnessNotice freshness={synced.freshness} noun="round" />
      {outcome ? (
        <p role="status" className="px-4 py-1 text-sm text-ink-muted">
          {outcome}
        </p>
      ) : null}
      {round ? (
        <DebateRoom
          media={mediaSlot?.(view)}
          actions={
            <RoundCommandActions
              view={view}
              actorId={actorId}
              nowMs={now}
              ids={ids}
              action={commandAction}
              onAnswer={onAnswer}
            />
          }
          round={round}
          sync={sync}
          notice={notice}
          save={save}
          leave={leave}
        />
      ) : null}
    </>
  );
}
