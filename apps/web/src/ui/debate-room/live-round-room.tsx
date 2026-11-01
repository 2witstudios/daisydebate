'use client';

import './zod-jitless';
import { roundMediaSlot } from '../../features/round-media/media-session';
import { useRoundAttendance } from '../../features/attendance/use-round-attendance';
import { createAttendanceReconnect } from '../../features/attendance/reconnect';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { systemId } from '@daisy/clock';
import type { RoundView } from '@daisy/protocol';
import type { RoundRead } from '../../features/round-runtime/read-round';
import { FreshnessNotice } from '../resource-sync/freshness-notice';
import { useLiveRoundView } from './use-live-round-view';
import type { LeaveLinks } from './leave-room';
import { liveRoundOf } from './live-round';
import { DebateRoom } from './room';
import { useRoundSync } from './use-round-sync';
import {
  roundCommandIds,
  type RoundCommandIds,
} from '../../features/round-runtime/command-ids';
import type { RoundFormState } from '../../features/round-runtime/command-form';
import type { FormAction } from '../form-action/form-action';
import { RoundCommandActions } from './round-command-actions';
import { leaveIntent } from '../../features/round-runtime/leave-intent';
import { RoundEndedNotice } from './round-ended';
import {
  useSecond,
  createRoundTime,
  defaultMonotonicClock,
  RESAMPLE_EVERY_MS,
  type RoundTime,
} from './use-second';

/**
 * The mounted round room: the position derived each second from the
 * round's durable snapshot, the snapshot kept current by round sync from
 * its doorbell and reads, never by re-rendering the route (ADR 0066), and
 * the debater's files saved on the persisted Round. A round this debater no
 * longer debates live leaves for its result page (`RoundCommandActions`),
 * showing the way there meanwhile.
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
  transcript,
}: {
  readonly transcript?: ReactNode;
  readonly view: RoundView;
  readonly commandIds: RoundCommandIds;
  readonly commandAction: FormAction<RoundFormState>;
  readonly attendanceSlot?: ReactNode;
  readonly mediaSlot?: (view: RoundView) => ReactNode;
  readonly renderedAtMs: number;
  readonly actorId: string;
  readonly leave: LeaveLinks;
  /** Posts the forfeit that leaving a live Round is (ADR 0070). */
  readonly leaveAction: FormAction<RoundFormState>;
  readonly read: () => Promise<RoundRead>;
  /** The realtime endpoint, or null when realtime is not configured. */
  readonly socketUrl: string | null;
}) {
  const reconnect = useMemo(() => createAttendanceReconnect(), []);
  // One shared round clock: SSR seed now, then every authorized read samples it.
  const generationRef = useRef(0);
  const [roundTime] = useState(() => {
    const at = performance.now();
    const seed = createRoundTime({ monotonicNowMs: defaultMonotonicClock });
    seed.sample({
      serverNowMs: renderedAtMs,
      sentAtMs: at,
      receivedAtMs: at,
      generation: 0,
    });
    return seed;
  });
  const sampledRead = useCallback(async () => {
    const response = await read();
    if (response.kind === 'found' && response.serverSample !== null)
      roundTime.sample({
        ...response.serverSample,
        generation: ++generationRef.current,
      });
    return response;
  }, [read, roundTime]);
  // Suspension or a stall must produce a fresh sample, not a frozen anchor.
  useEffect(() => {
    const timer = window.setInterval(
      () => void sampledRead(),
      RESAMPLE_EVERY_MS,
    );
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void sampledRead();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [sampledRead]);
  const [synced, driver] = useLiveRoundView({
    view: seed,
    read: sampledRead,
    socketUrl,
    onConnectionOpen: reconnect.opened,
  });
  const view = synced.value;
  const refresh = useCallback(() => driver?.signal(), [driver]);
  const now = useSecond(renderedAtMs, roundTime);
  const round = useMemo(
    () => liveRoundOf(view, actorId, now),
    [view, actorId, now],
  );
  const defaultMedia = useMemo(
    () => roundMediaSlot(refresh, roundTime),
    [refresh, roundTime],
  );
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
      setOutcome(answer.error ?? 'Done.');
      if (answer.view) driver?.accepted(answer.view);
      else if (answer.error) driver?.signal();
    },
    [driver],
  );
  const { sync, notice, save } = useRoundSync(view.id);
  const intent = leaveIntent(view, actorId, now);
  const leaving: LeaveLinks =
    intent.kind === 'forfeit'
      ? {
          ...leave,
          forfeit: {
            action: leaveAction,
            commandId: ids.forfeit,
            expectedVersion: intent.expectedVersion,
            participantId: intent.participantId,
          },
        }
      : { ...leave, freed: intent.kind === 'freed' };
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
              transcript={transcript}
              media={(mediaSlot ?? defaultMedia)(view)}
              actions={actions}
              round={round}
              sync={sync}
              notice={notice}
              save={save}
              leave={leaving}
            />
          ) : (
            <RoundEndedNotice roundId={view.id} />
          )
        }
      </RoundCommandActions>
    </>
  );
}
