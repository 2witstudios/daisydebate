'use client';

import './zod-jitless';
import { roundMediaSlot } from '../../features/round-media/media-session';
import { useRoundAttendance } from '../../features/attendance/use-round-attendance';
import { createAttendanceReconnect } from '../../features/attendance/reconnect';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { systemClock, systemId } from '@daisy/clock';
import type { RoundView } from '@daisy/protocol';
import type { RoundRead } from '../../features/rooms/read-round';
import { FreshnessNotice } from '../resource-sync/freshness-notice';
import { useLiveRoundView } from './use-live-round-view';
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
import { roundControlIntents } from '../../features/round-runtime/control-intents';

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
  leaveAction,
  read,
  socketUrl,
  commandAction,
  commandIds: seedIds,
  mediaSlot,
  attendanceSlot,
}: {
  readonly view: RoundView;
  readonly commandIds: RoundCommandIds;
  readonly commandAction: FormAction<RoundFormState>;
  readonly attendanceSlot?: ReactNode;
  readonly mediaSlot?: (view: RoundView) => ReactNode;
  readonly renderedAtMs: number;
  readonly actorId: string;
  readonly leave: LeaveLinks;
  /** Posts the forfeit that leaving a live Round is (ADR 0069). */
  readonly leaveAction: FormAction<RoundFormState>;
  readonly read: () => Promise<RoundRead>;
  /** The realtime endpoint, or null when realtime is not configured. */
  readonly socketUrl: string | null;
}) {
  const reconnect = useMemo(() => createAttendanceReconnect(), []);
  const [synced, driver] = useLiveRoundView({
    view: seed,
    read,
    socketUrl,
    onConnectionOpen: reconnect.opened,
  });
  const view = synced.value;
  const refresh = useCallback(() => driver?.signal(), [driver]);
  const defaultMedia = useMemo(() => roundMediaSlot(refresh), [refresh]);
  useRoundAttendance({ view, actorId, reconnect });
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
  const now = useSecond(renderedAtMs);
  const round = useMemo(
    () => liveRoundOf(view, actorId, now),
    [view, actorId, now],
  );
  const { sync, notice, save } = useRoundSync(view.id);
  // Leaving forfeits a scheduled Round (it is abandoned) and an active one
  // while forfeit is a legal intent; after the last speech the debater
  // just leaves for the lobby.
  const forfeitable =
    (view.status === 'scheduled' && isLiveDebater(view, actorId)) ||
    roundControlIntents(view, actorId, now).some(
      (intent) => intent.type === 'forfeit' && intent.enabled,
    );
  const leaving: LeaveLinks = forfeitable
    ? {
        ...leave,
        forfeit: {
          action: leaveAction,
          commandId: ids.forfeit,
          expectedVersion: view.version,
        },
      }
    : leave;
  return (
    <>
      <FreshnessNotice freshness={synced.freshness} noun="round" />
      {outcome ? (
        <p role="status" className="px-4 py-1 text-sm text-ink-muted">
          {outcome}
        </p>
      ) : null}
      {attendanceSlot}
      <RoundCommandActions
        view={view}
        actorId={actorId}
        nowMs={now}
        ids={ids}
        action={commandAction}
        onAnswer={onAnswer}
      >
        {(actions) =>
          round ? (
            <DebateRoom
              media={(mediaSlot ?? defaultMedia)(view)}
              actions={actions}
              round={round}
              sync={sync}
              notice={notice}
              save={save}
              leave={leaving}
            />
          ) : null
        }
      </RoundCommandActions>
    </>
  );
}
