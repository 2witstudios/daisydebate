'use client';
import { useEffect, useRef, useState } from 'react';
import { Room, RoomEvent, Track, type RemoteTrack } from 'livekit-client';
import {
  applyStageSubscriptions,
  seatMedia,
  subscribesTo,
  type StageParticipant,
} from './stage-subscriptions';
import type { StageRoomHandle } from './stage-connection';
import { drawableStageAnswer, type StageAnswer } from './stage-answer';
import { createStageConnection } from './stage-connector';
import { mayStartRecording, whenFontsSettle } from './stage-fonts';
import { startStagePoll } from './stage-poll';
import { stageWatchStart, watchedStage } from './stage-watch';
import { StageView, type StageLink } from './stage-view';

const POLL_MS = 1000;
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

/** The LiveKit room the stage joins, under the observer token and without retries of its own. */
type StageMediaRoom = StageRoomHandle & { readonly room: Room };

/** One read of the stage: its HTTP status (null for no answer) and its snapshot, if readable. */
type StageRead = {
  readonly status: number | null;
  readonly next: StageAnswer | null;
};

/** Fills its seat, so the 540p top layer reaches the frame close to one to one. */
function StageTile({ track }: { readonly track: RemoteTrack | undefined }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = video.current;
    if (!track || !element) return undefined;
    track.attach(element);
    return () => void track.detach(element);
  }, [track]);
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
 * Connects under the observer token and rejoins when the Round's room rotates or the
 * media server cannot be reached: the link shows reconnecting until a room is joined.
 */
export function StageRoom(props: {
  readonly captureId: string;
  readonly credential: string;
}) {
  const [stage, setStage] = useState<StageAnswer | null>(null);
  const [link, setLink] = useState<StageLink>('reconnecting');
  const [cameras, setCameras] = useState<ReadonlyMap<string, RemoteTrack>>(
    new Map(),
  );
  const [participants, setParticipants] = useState<readonly StageParticipant[]>(
    [],
  );
  const started = useRef(false);
  const watch = useRef(stageWatchStart);
  const identities = useRef<readonly string[]>([]);
  useEffect(() => {
    const connection = createStageConnection<StageMediaRoom>({
      createRoom: () => {
        const room = new Room({ adaptiveStream: false, dynacast: false });
        const media: StageMediaRoom = {
          room,
          // One attempt per read: the poll is the retry, so attempts never stack.
          connect: (url, token) =>
            room.connect(url, token, { autoSubscribe: false, maxRetries: 0 }),
          disconnect: () => room.disconnect(),
        };
        room.on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
          if (!subscribesTo(identities.current, participant.identity)) return;
          if (track.kind === Track.Kind.Video)
            setCameras((all) => new Map(all).set(participant.identity, track));
          else document.body.appendChild(track.attach());
        });
        room.on(RoomEvent.TrackUnsubscribed, (track, _pub, participant) => {
          // A room the stage let go may still unsubscribe; the tiles belong to the held one.
          if (track.kind !== Track.Kind.Video)
            track.detach().forEach((element) => element.remove());
          else if (connection.joinedRoom() === media)
            setCameras((all) => {
              const rest = new Map(all);
              rest.delete(participant.identity);
              return rest;
            });
        });
        room.on(RoomEvent.Reconnecting, () =>
          connection.on({ type: 'resuming', room: media }),
        );
        room.on(RoomEvent.Reconnected, () =>
          connection.on({ type: 'resumed', room: media }),
        );
        room.on(RoomEvent.Disconnected, () => {
          if (connection.dropped(media)) setCameras(new Map());
        });
        return media;
      },
      onLink: setLink,
    });
    /** One whole answer, body included, so the poll can order it; never rejects. */
    const read = async (): Promise<StageRead> => {
      // A web tier that is gone may never answer, so a read cannot wait for it.
      const answer = await fetch(`/api/stage/${props.captureId}`, {
        headers: { 'x-stage-credential': props.credential },
        cache: 'no-store',
        signal: AbortSignal.timeout(READ_TIMEOUT_MS),
      }).catch(() => null);
      // A body cut off mid-read is no new answer; the next read tries again.
      const next = answer?.ok
        ? drawableStageAnswer(await answer.json().catch(() => null))
        : null;
      return { status: answer?.status ?? null, next };
    };
    const apply = ({ status, next }: StageRead) => {
      watch.current = watchedStage(watch.current, status, performance.now());
      if (watch.current.ended) {
        // Egress stops on exactly this line. Nothing else can stop it with the web gone.
        // eslint-disable-next-line no-console
        console.log('END_RECORDING');
        stop();
        connection.close();
        return;
      }
      if (next) show(next);
    };
    const show = (next: StageAnswer) => {
      setStage(next);
      identities.current = next.debaterIdentities;
      const present = connection.joinedRoom()?.room;
      setParticipants([...(present?.remoteParticipants.values() ?? [])]);
      if (present)
        applyStageSubscriptions(
          present.remoteParticipants.values(),
          next.debaterIdentities,
          next.phase,
        );
      // Not awaited: a connect may take seconds, and the watch must keep reading.
      if (next.room) void connection.offer(next.room);
    };
    // apply() runs only after a read settles, so the poll has returned by then.
    const stop = startStagePoll({
      read,
      apply,
      every: (tick) => {
        const handle = setInterval(tick, POLL_MS);
        return () => clearInterval(handle);
      },
    });
    return () => {
      stop();
      connection.close();
    };
  }, [props.captureId, props.credential]);
  const shown = stage !== null;
  useEffect(() => {
    if (!shown || started.current) return undefined;
    started.current = true;
    let mounted = true;
    void whenFontsSettle({
      load: loadFrameFaces,
      wait: (ms) => new Promise((done) => setTimeout(done, ms)),
      limitMs: FONT_WAIT_MS,
    }).then(() => {
      if (!mayStartRecording({ mounted, ended: watch.current.ended })) return;
      // Egress waits for exactly this line before it records (awaitStartSignal).
      // eslint-disable-next-line no-console
      console.log('START_RECORDING');
    });
    return () => {
      mounted = false;
    };
  }, [shown]);
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
