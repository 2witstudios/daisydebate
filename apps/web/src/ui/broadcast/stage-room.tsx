'use client';
import { useEffect, useRef, useState } from 'react';
import { Room, RoomEvent, Track } from 'livekit-client';
import { StageView, type StageSnapshot } from './stage-view';

const POLL_MS = 1000;
const SITE_LINK = 'daisydebate.com';

type StageAnswer = StageSnapshot & {
  /** The server's clock, so the burned-in countdown never reads the browser's. */
  readonly nowMs: number;
  readonly debaterIdentities: readonly string[];
  readonly room: { readonly url: string; readonly token: string } | null;
};

/** Connects under the observer token and rejoins when the Round's room rotates. */
export function StageRoom(props: {
  readonly broadcastId: string;
  readonly credential: string;
}) {
  const [stage, setStage] = useState<StageAnswer | null>(null);
  const tiles = useRef<HTMLDivElement>(null);
  const roomRef = useRef<Room | null>(null);
  const started = useRef(false);
  const identities = useRef<readonly string[]>([]);
  useEffect(() => {
    const read = async () => {
      const answer = await fetch(`/api/broadcasts/${props.broadcastId}/stage`, {
        headers: { 'x-stage-credential': props.credential },
        cache: 'no-store',
      });
      if (!answer.ok) return;
      const next = (await answer.json()) as StageAnswer;
      setStage(next);
      identities.current = next.debaterIdentities;
      const present = roomRef.current;
      if (present)
        for (const participant of present.remoteParticipants.values())
          if (identities.current.includes(participant.identity))
            for (const publication of participant.trackPublications.values())
              publication.setSubscribed(true);
      if (!started.current) {
        started.current = true;
        // Egress waits for exactly this line before it records (awaitStartSignal).
        // eslint-disable-next-line no-console
        console.log('START_RECORDING');
      }
      const connected = roomRef.current;
      if (next.room && !connected) {
        const room = new Room({ adaptiveStream: false, dynacast: false });
        roomRef.current = room;
        room.on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
          if (!identities.current.includes(participant.identity)) return;
          const element = track.attach();
          if (track.kind === Track.Kind.Video) {
            element.style.width = '50%';
            tiles.current?.appendChild(element);
          } else document.body.appendChild(element);
        });
        room.on(RoomEvent.TrackUnsubscribed, (track) =>
          track.detach().forEach((element) => element.remove()),
        );
        room.on(RoomEvent.Disconnected, () => {
          roomRef.current = null;
        });
        await room.connect(next.room.url, next.room.token, {
          autoSubscribe: false,
        });
        room.on(RoomEvent.TrackPublished, (publication, participant) => {
          if (identities.current.includes(participant.identity))
            publication.setSubscribed(true);
        });
      }
    };
    void read();
    const handle = setInterval(() => void read(), POLL_MS);
    return () => {
      clearInterval(handle);
      void roomRef.current?.disconnect();
    };
  }, [props.broadcastId, props.credential]);
  return stage ? (
    <StageView
      snapshot={stage}
      nowMs={stage.nowMs}
      siteLink={SITE_LINK}
      tiles={<div ref={tiles} className="flex w-full" />}
    />
  ) : null;
}
