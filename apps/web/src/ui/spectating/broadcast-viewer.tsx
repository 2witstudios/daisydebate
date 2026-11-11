'use client';
import '../../lib/zod-jitless';
import { type SpectatorTimeline } from '@daisy/protocol';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useLayoutEffect, useReducer } from 'react';
import { replayHref, watchRoutes } from '../../features/watch/routes';
import { ActionLink } from '../watch/action-link/action-link';
import { RecordingPreparationStatus } from '../recording/recording-preparation/recording-preparation';
import { StateCard } from '../watch/state-card/state-card';
import { StreamThisRound } from '../broadcast/stream-this-round/stream-this-round';
import { BroadcastPlayer } from './broadcast-player';
import {
  PublishedAudience,
  type PublishedState,
  usePublishedState,
} from './published-state';
import { SpectatorFacts } from './spectator-timeline';
import {
  streamableFeedOf,
  timelineAsOf,
  type ViewerScreen,
  viewerScreenOf,
  viewerSettled,
} from './viewer-screen';
import { attemptOf, firstViewing, reduceViewing } from './viewing';

const browseRecordings = (
  <ActionLink href={watchRoutes.recordings}>Browse recordings</ActionLink>
);

function EndedCard({
  roundId,
  recording,
  preparation,
}: {
  readonly roundId: string;
  readonly recording: SpectatorTimeline['recording'];
  readonly preparation: SpectatorTimeline['recordingPreparation'];
}) {
  switch (recording) {
    case 'ready':
      return (
        <StateCard
          icon="play"
          title="This debate has ended"
          actions={
            <ActionLink href={replayHref(roundId)} variant="primary">
              Watch the recording
            </ActionLink>
          }
        />
      );
    case 'processing':
      return (
        <StateCard icon="clock" title="This debate has ended">
          <p>
            The recording is being prepared and opens here when it is ready.
          </p>
          <RecordingPreparationStatus preparation={preparation} />
        </StateCard>
      );
    case 'failed':
      return (
        <StateCard
          icon="alert"
          title="This debate has ended"
          actions={browseRecordings}
        >
          <p>The recording of this debate could not be saved.</p>
        </StateCard>
      );
    case 'none':
      return (
        <StateCard
          icon="play"
          title="This debate has ended"
          actions={browseRecordings}
        />
      );
  }
}

/** Every state that replaces the player, each saying what is actually so. */
function StateInsteadOfPlayer({
  screen,
  roundId,
  onRetry,
}: {
  readonly screen: Exclude<ViewerScreen, { kind: 'player' }>;
  readonly roundId: string;
  readonly onRetry: () => void;
}) {
  switch (screen.kind) {
    case 'upcoming':
      return <StateCard icon="clock" title="This debate has not started" />;
    case 'starting':
      return (
        <StateCard icon="clock" title="The broadcast is starting">
          <p>It plays here by itself once it is out.</p>
        </StateCard>
      );
    case 'interrupted':
      return (
        <StateCard icon="alert" title="The broadcast is interrupted">
          <p>It plays here by itself once it is back.</p>
        </StateCard>
      );
    case 'stopped':
      return (
        <StateCard
          icon="alert"
          title="This broadcast was stopped"
          actions={browseRecordings}
        />
      );
    case 'failed':
      return (
        <StateCard
          icon="alert"
          title="This broadcast could not be shown"
          actions={browseRecordings}
        />
      );
    case 'unplayable':
      return (
        <StateCard
          icon="alert"
          title="The video could not be played"
          actions={
            <button type="button" onClick={onRetry} className="font-strong">
              Try again
            </button>
          }
        />
      );
    case 'no-broadcast':
      return (
        <StateCard
          icon="eye"
          title="This debate is not being broadcast"
          actions={
            <ActionLink href={watchRoutes.hub}>See live debates</ActionLink>
          }
        />
      );
    case 'ended':
      return (
        <EndedCard
          roundId={roundId}
          recording={screen.recording}
          preparation={screen.preparation}
        />
      );
  }
}

const playerNotices = {
  slate: 'The video is showing a slate. Nobody is speaking.',
  interrupted: 'The broadcast is interrupted. It resumes here by itself.',
} as const;

/** The facts on the page: what was read, or the server's own once its address is gone. */
const timelineRead = (
  initial: SpectatorTimeline,
  published: PublishedState,
): SpectatorTimeline =>
  published.gone
    ? initial
    : timelineAsOf(
        published.state?.timeline ?? initial,
        published.sinceMovedMs,
      );

/**
 * The public Round page after its first render: the publisher's published state, read
 * from the public bucket every couple of seconds the way the player reads segments,
 * so no viewer's read reaches web (DEC-350). No socket and no account. A failed read
 * keeps the last released facts. With nothing published the page does not poll, and
 * says how to look again.
 */
export function BroadcastViewer({
  initial,
  stateUrl,
  refreshHref,
  children,
}: {
  readonly initial: SpectatorTimeline;
  /** Where the published state is read; null with no Broadcast. */
  readonly stateUrl: string | null;
  readonly refreshHref: string;
  /** The audience beside the video: chat, reactions and the count. */
  readonly children?: React.ReactNode;
}) {
  const router = useRouter();
  const [viewing, dispatch] = useReducer(reduceViewing, firstViewing);
  // What was read belongs to its address, so a refresh that names a replaced
  // link reads the new one, and the player and the audience beside it stay.
  const published = usePublishedState(
    stateUrl,
    (read) => !viewerSettled(timelineRead(initial, read)),
  );
  const { serverAsks } = published;
  const timeline = timelineRead(initial, published);
  const settled = viewerSettled(timeline);
  const { broadcast, roundId } = timeline;
  const screen = viewerScreenOf(timeline, viewing);
  const playing = screen.kind === 'player' ? screen.stream : null;
  const attempt = attemptOf(viewing);
  // A layout effect, so the viewing is on this stream before its player's own
  // effect can report: a browser with no engine gives up as the player mounts.
  useLayoutEffect(() => {
    if (playing) dispatch({ kind: 'shown', stream: playing });
  }, [playing]);
  const switchToRecording =
    screen.kind === 'ended' && screen.recording === 'ready';
  // Withdrawn, or a replaced link: the server says what this reader may still see.
  // It is asked again, ever less often, while the address stays gone, since it can
  // name the same address now and a replaced link later.
  useEffect(() => {
    if (serverAsks > 0) router.refresh();
  }, [serverAsks, router]);
  useEffect(() => {
    if (switchToRecording) router.replace(replayHref(roundId));
  }, [switchToRecording, router, roundId]);
  const feedUrl = streamableFeedOf(timeline);
  return (
    <div className="mx-auto flex w-full max-w-dash-column flex-col gap-6 px-6 pt-5 pb-8 max-compact:gap-4 max-compact:px-4">
      <Link href={watchRoutes.hub} className="self-start text-sm font-strong">
        All live debates
      </Link>
      <div data-broadcast-state={broadcast.state}>
        {screen.kind === 'player' ? (
          <div className="flex flex-col gap-2">
            <BroadcastPlayer
              key={`${screen.stream.manifestUrl}:${attempt}`}
              stream={screen.stream}
              captions={timeline.captions}
              onFinished={() =>
                dispatch({
                  kind: 'finished',
                  player: { manifestUrl: screen.stream.manifestUrl, attempt },
                })
              }
              onFailed={() =>
                dispatch({
                  kind: 'failed',
                  player: { manifestUrl: screen.stream.manifestUrl, attempt },
                })
              }
            />
            {screen.notice ? (
              <p role="status" className="text-sm text-ink-muted">
                {playerNotices[screen.notice]}
              </p>
            ) : null}
            <noscript>
              <p className="text-sm text-ink-muted">
                The video needs JavaScript. The facts below stay current on
                reload.
              </p>
            </noscript>
          </div>
        ) : (
          <StateInsteadOfPlayer
            screen={screen}
            roundId={roundId}
            onRetry={() => dispatch({ kind: 'retried' })}
          />
        )}
      </div>
      <SpectatorFacts timeline={timeline} />
      {stateUrl === null && !settled ? (
        <p className="text-sm text-ink-muted">
          This page does not update by itself.{' '}
          <a href={refreshHref} className="font-strong">
            Refresh
          </a>
        </p>
      ) : null}
      <PublishedAudience.Provider value={published.state}>
        {children}
      </PublishedAudience.Provider>
      {feedUrl ? (
        <StreamThisRound feedUrl={feedUrl} mode={timeline.mode} />
      ) : null}
    </div>
  );
}
