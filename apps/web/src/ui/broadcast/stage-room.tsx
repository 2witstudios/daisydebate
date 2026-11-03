'use client';
import { useEffect, useRef, useState } from 'react';
import { Room, RoomEvent, Track, type RemoteTrack } from 'livekit-client';
import {
  applyStageSubscriptions,
  seatMedia,
  subscribesTo,
  type StageParticipant,
} from './stage-subscriptions';
import { StageView, type StageLink, type StageSnapshot } from './stage-view';

const POLL_MS = 1000;
const SITE_LINK = 'daisydebate.com';

type StageAnswer = StageSnapshot & {
  /** The server's clock, so the burned-in countdown never reads the browser's. */
  readonly nowMs: number;
  readonly debaterIdentities: readonly string[];
  readonly room: { readonly url: string; readonly token: string } | null;
};

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

/** Connects under the observer token and rejoins when the Round's room rotates. */
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
  const roomRef = useRef<Room | null>(null);
  const started = useRef(false);
  const identities = useRef<readonly string[]>([]);
  useEffect(() => {
    const read = async () => {
      const answer = await fetch(`/api/stage/${props.captureId}`, {
        headers: { 'x-stage-credential': props.credential },
        cache: 'no-store',
      });
      if (!answer.ok) return;
      const next = (await answer.json()) as StageAnswer;
      setStage(next);
      identities.current = next.debaterIdentities;
      const present = roomRef.current;
      setParticipants([...(present?.remoteParticipants.values() ?? [])]);
      if (present)
        applyStageSubscriptions(
          present.remoteParticipants.values(),
          next.debaterIdentities,
          next.phase,
        );
      if (!started.current) {
        started.current = true;
        // Egress waits for exactly this line before it records (awaitStartSignal).
        // eslint-disable-next-line no-console
        console.log('START_RECORDING');
      }
      if (next.room && !present) {
        const room = new Room({ adaptiveStream: false, dynacast: false });
        roomRef.current = room;
        room.on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
          if (!subscribesTo(identities.current, participant.identity)) return;
          if (track.kind === Track.Kind.Video)
            setCameras((all) => new Map(all).set(participant.identity, track));
          else document.body.appendChild(track.attach());
        });
        room.on(RoomEvent.TrackUnsubscribed, (track, _pub, participant) => {
          if (track.kind === Track.Kind.Video)
            setCameras((all) => {
              const rest = new Map(all);
              rest.delete(participant.identity);
              return rest;
            });
          else track.detach().forEach((element) => element.remove());
        });
        room.on(RoomEvent.Reconnecting, () => setLink('reconnecting'));
        room.on(RoomEvent.Reconnected, () => setLink('connected'));
        room.on(RoomEvent.Connected, () => setLink('connected'));
        room.on(RoomEvent.Disconnected, () => {
          roomRef.current = null;
          setLink('reconnecting');
          setCameras(new Map());
        });
        await room.connect(next.room.url, next.room.token, {
          autoSubscribe: false,
        });
      }
    };
    void read();
    const handle = setInterval(() => void read(), POLL_MS);
    return () => {
      clearInterval(handle);
      void roomRef.current?.disconnect();
    };
  }, [props.captureId, props.credential]);
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
