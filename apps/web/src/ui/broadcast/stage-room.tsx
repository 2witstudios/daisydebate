'use client';
import {
  browserTransport,
  type BrowserTransport,
} from '../edge/browser-request';
import { pause } from '../edge/browser-waits';
import { browserScheduler } from '../edge/browser-time';
import { useDriver, useResource } from '../edge/use-driver';
import { useCallback, useRef } from 'react';
import { Room, RoomEvent, Track, type RemoteTrack } from 'livekit-client';
import { seatMedia } from './stage-subscriptions';
import { drawableStageAnswer } from './stage-answer';
import { whenFontsSettle } from './stage-fonts';
import {
  createStageRoomDriver,
  stageRoomStart,
  type StageMediaEvents,
  type StageMediaRoom,
} from './stage-driver';
import { StageView } from './stage-view';

const READ_TIMEOUT_MS = 3000;
const SITE_LINK = 'daisydebate.com';
/** Long enough for self-hosted faces; short enough that a lost one costs no speech. */
const FONT_WAIT_MS = 2000;

/**
 * The display and body faces by the names the root layout gives them, with the frame's
 * own characters so the subset that holds them is the one fetched.
 */
const loadFrameFaces = () => {
  const theme = getComputedStyle(document.documentElement);
  return Promise.all(
    ['--font-face-display', '--font-face-sans'].map((face) =>
      document.fonts.load(`1em ${theme.getPropertyValue(face)}`, 'Daisy 0:00'),
    ),
  );
};

/** The stage's own read, under its credential; no answer reads as null. */
const readStage = (
  fetch: BrowserTransport,
  {
    captureId,
    credential,
  }: { readonly captureId: string; readonly credential: string },
) =>
  fetch(`/api/stage/${captureId}`, {
    headers: { 'x-stage-credential': credential },
    cache: 'no-store',
    signal: AbortSignal.timeout(READ_TIMEOUT_MS),
  }).catch(() => null);

/** Fills its seat, so the 540p top layer reaches the frame close to one to one. */
function StageTile({ track }: { readonly track: RemoteTrack | undefined }) {
  const video = useRef<HTMLVideoElement>(null);
  useResource(track, (shown) => {
    const element = video.current;
    if (!shown || !element) return null;
    shown.attach(element);
    return { dispose: () => void shown.detach(element) };
  });
  return (
    <video
      ref={video}
      autoPlay
      muted
      playsInline
      className="size-full object-cover"
    />
  );
}

/**
 * The LiveKit room the stage joins, under the observer token and without
 * retries of its own, reporting by the stage's names. Voices play from the
 * document body.
 */
const liveKitRoom = (events: StageMediaEvents<RemoteTrack>): StageMediaRoom => {
  const room = new Room({ adaptiveStream: false, dynacast: false });
  room.on(RoomEvent.TrackSubscribed, (track, _pub, participant) =>
    events.subscribed(
      participant.identity,
      track,
      track.kind === Track.Kind.Video,
    ),
  );
  room.on(RoomEvent.TrackUnsubscribed, (track, _pub, participant) =>
    events.unsubscribed(
      participant.identity,
      track,
      track.kind === Track.Kind.Video,
    ),
  );
  room.on(RoomEvent.Reconnecting, events.resuming);
  room.on(RoomEvent.Reconnected, events.resumed);
  room.on(RoomEvent.Disconnected, events.disconnected);
  return {
    // One attempt per read: the poll is the retry, so attempts never stack.
    connect: (url, token) =>
      room.connect(url, token, { autoSubscribe: false, maxRetries: 0 }),
    disconnect: () => room.disconnect(),
    participants: () => [...room.remoteParticipants.values()],
  };
};

/** The stage of one capture on the browser's transport, timers, fonts and LiveKit. */
const startStage = (capture: {
  readonly captureId: string;
  readonly credential: string;
}) =>
  createStageRoomDriver<RemoteTrack>({
    read: async () => {
      // A web tier that is gone may never answer, so a read cannot wait for it.
      const answer = await readStage(browserTransport, capture);
      // A body cut off mid-read is no new answer; the next read tries again.
      const next = answer?.ok
        ? drawableStageAnswer(await answer.json().catch(() => null))
        : null;
      return { status: answer?.status ?? null, next };
    },
    every: browserScheduler.every,
    now: () => performance.now(),
    createRoom: liveKitRoom,
    play: (track) => void document.body.appendChild(track.attach()),
    release: (track) => track.detach().forEach((element) => element.remove()),
    fontsSettled: () =>
      whenFontsSettle({
        load: loadFrameFaces,
        wait: pause,
        limitMs: FONT_WAIT_MS,
      }),
    // Egress waits for exactly these lines (awaitStartSignal) and stops on the end.
    // eslint-disable-next-line no-console
    signal: (line) => console.log(line),
  });

/**
 * Connects under the observer token and rejoins when the Round's room rotates or the
 * media server cannot be reached: the link shows reconnecting until a room is joined.
 */
export function StageRoom(props: {
  readonly captureId: string;
  readonly credential: string;
}) {
  const { captureId, credential } = props;
  const start = useCallback(
    () => startStage({ captureId, credential }),
    [captureId, credential],
  );
  const [{ stage, link, cameras, participants }] = useDriver(
    stageRoomStart<RemoteTrack>,
    start,
  );
  if (!stage) return null;
  return (
    <StageView
      snapshot={stage}
      nowMs={stage.nowMs}
      siteLink={SITE_LINK}
      link={link}
      mediaOf={(seat) => seatMedia(seat, participants)}
      tile={(seat) => (
        <StageTile
          track={
            seat.identity === null ? undefined : cameras.get(seat.identity)
          }
        />
      )}
    />
  );
}
