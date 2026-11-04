'use client';

import '../../lib/zod-jitless';
import type { LocalPublication } from '../../features/round-media/model/media-publication';
import { roundMediaSlot } from '../../features/round-media/media-session';
import { clearAccountResumeRecords } from '../../features/rooms/resume-departure';
import { useRoundMediaTab } from './use-round-media-tab';
import { useRoundAttendance } from '../../features/attendance/use-round-attendance';
import { createAttendanceReconnect } from '../../features/attendance/reconnect';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { systemId } from '@daisy/clock';
import type { RoundView } from '@daisy/protocol';
import type { RoundRead } from '../../features/round-runtime/read-round';
import { FreshnessNotice } from '../resource-sync/freshness-notice';
import { useLiveRoundView } from './use-live-round-view';
import type { LeaveLinks } from './leave-room';
import { liveRoundOf } from './live-round';
import { DebateRoom } from './room';
import { useDocumentSaving } from '../documents/use-document-saving';
import { ManagerWorkspace } from '../documents/document-manager';
import {
  roundCommandIds,
  type RoundCommandIds,
} from '../../features/round-runtime/command-ids';
import type { RoundFormState } from '../../features/round-runtime/command-form';
import type { FormAction } from '../form-action/form-action';
import { OpeningChosen, OpeningStrike } from './opening-strike';
import { RoundCommandActions } from './round-command-actions';
import { leaveIntent } from '../../features/round-runtime/leave-intent';
import { RoundEndedNotice } from './round-ended';
import { useSecond } from './use-second';
import { useRoundTime } from './use-round-time';
import { ConversationHeldNotice } from './conversation-held-notice';
import { RoundIncidentBanner } from './round-incident-banner';
import { RoundTimeNotice } from './round-time-notice';

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
  principalId,
  renderedAtMs,
  leave,
  leaveAction,
  read,
  socketUrl,
  commandAction,
  commandIds: seedIds,
  mediaSlot,
  attendanceSlot,
  audienceSlot,
  transcript,
}: {
  readonly transcript?: ReactNode;
  readonly view: RoundView;
  readonly commandIds: RoundCommandIds;
  readonly commandAction: FormAction<RoundFormState>;
  readonly attendanceSlot?: ReactNode;
  /** Spectator chat, on a non-ranked Round whose host left it on (SPECT-1.4). */
  readonly audienceSlot?: ReactNode;
  readonly mediaSlot?: (view: RoundView) => ReactNode;
  readonly renderedAtMs: number;
  readonly actorId: string;
  readonly principalId: string;
  readonly leave: LeaveLinks;
  /** Posts the forfeit that leaving a live Round is (ADR 0070). */
  readonly leaveAction: FormAction<RoundFormState>;
  readonly read: () => Promise<RoundRead>;
  /** The realtime endpoint, or null when realtime is not configured. */
  readonly socketUrl: string | null;
}) {
  const reconnect = useMemo(() => createAttendanceReconnect(), []);
  // One shared round clock: the SSR render instant seeds it, then its own
  // sampler calibrates the seam display and media read.
  const { roundTime, wakeClock } = useRoundTime({
    renderedAtMs,
    clockUrl: `/api/rounds/${seed.id}`,
  });
  const onConnectionOpen = useCallback(() => {
    reconnect.opened();
    wakeClock();
  }, [reconnect, wakeClock]);
  const [synced, driver] = useLiveRoundView({
    view: seed,
    read,
    socketUrl,
    onConnectionOpen,
  });
  const view = synced.value;
  const refresh = useCallback(() => driver?.signal(), [driver]);
  const now = useSecond(renderedAtMs, roundTime);
  const round = useMemo(
    () => liveRoundOf(view, actorId, now),
    [view, actorId, now],
  );
  const [publication, setPublication] = useState<LocalPublication>(null);
  const tab = useRoundMediaTab(actorId, view);
  const defaultMedia = useMemo(
    () =>
      roundMediaSlot({
        onRefresh: refresh,
        roundTime,
        actorId,
        tab,
        onPublication: setPublication,
        onAccountChanged: clearAccountResumeRecords,
      }),
    [refresh, roundTime, actorId, tab],
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
      if (!answer.error) setOutcome('Done.');
      if (answer.view) driver?.accepted(answer.view);
      else if (answer.error) driver?.signal();
    },
    [driver],
  );
  const { sync, notice, save } = useDocumentSaving(principalId, socketUrl);
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
      : {
          ...leave,
          freed: intent.kind === 'freed',
          held: intent.kind === 'held',
        };
  const notices = (
    <>
      <FreshnessNotice freshness={synced.freshness} noun="round" />
      <ConversationHeldNotice view={view} nowMs={now} />
      <RoundTimeNotice roundTime={roundTime} />
      <RoundIncidentBanner checkpoint={view.checkpoint} nowMs={now} />
      {outcome ? (
        <p role="status" className="sr-only">
          {outcome}
        </p>
      ) : null}
      {attendanceSlot}
      {view.opening?.draw ? (
        <OpeningChosen view={view} draw={view.opening.draw} actorId={actorId} />
      ) : null}
    </>
  );
  return (
    <RoundCommandActions
      view={view}
      actorId={actorId}
      nowMs={now}
      ids={ids}
      action={commandAction}
      onAnswer={onAnswer}
    >
      {(actions, feedback, form) =>
        view.opening?.step.step === 'strike' && view.opening.draw ? (
          <>
            {notices}
            {feedback}
            <OpeningStrike
              view={view}
              opening={view.opening}
              draw={view.opening.draw}
              actorId={actorId}
              nowMs={now}
              commandId={ids.strike_resolution}
              post={form.post}
              pending={form.pending}
            />
          </>
        ) : round ? (
          <DebateRoom
            key={`${view.id}:${principalId}`}
            transcript={transcript}
            notices={
              <>
                {notices}
                {feedback}
                {audienceSlot}
              </>
            }
            media={(mediaSlot ?? defaultMedia)(view)}
            publication={publication}
            actions={actions}
            round={round}
            sync={sync}
            notice={notice}
            save={save}
            leave={leaving}
          />
        ) : (
          <>
            {notices}
            {feedback}
            <RoundEndedNotice
              roundId={view.id}
              actorId={actorId}
              roomId={view.roomId}
            />
            {/* A document is not the Round's, so its end stops no one typing. */}
            <ManagerWorkspace
              sync={sync}
              notice={notice}
              save={save}
              back={`/rounds/${view.id}`}
              title="Your files"
            />
          </>
        )
      }
    </RoundCommandActions>
  );
}
