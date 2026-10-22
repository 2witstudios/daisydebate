'use client';
import { useEffect, useRef } from 'react';
import type { RoundView, RoundMediaState } from '@daisy/protocol';
import type { MediaTrack } from './browser-transport';

function TrackElement({ track }: { readonly track: MediaTrack }) {
  const element = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  useEffect(() => {
    const node = element.current;
    if (!node) return;
    track.track.attach(node);
    return () => {
      track.track.detach(node);
      node.srcObject = null;
    };
  }, [track]);
  return track.source === 'camera' ? (
    <video
      ref={element}
      autoPlay
      playsInline
      muted={track.local}
      className="h-full w-full object-cover"
      aria-label={track.local ? 'Your camera' : 'Participant camera'}
    />
  ) : (
    <audio ref={element} autoPlay aria-label="Participant audio" />
  );
}

/** Only named debaters become tiles; a hidden judge never enters the identity map. */
export function MediaStage({
  view,
  media,
  tracks,
}: {
  readonly view: RoundView;
  readonly media: RoundMediaState | null;
  readonly tracks: readonly MediaTrack[];
}) {
  return (
    <div
      className="grid min-w-0 grid-cols-2 gap-2 bg-surface-sunken p-3"
      aria-label="Round participants"
    >
      {view.participants
        .filter((seat) => seat.role !== 'judge' && 'id' in seat)
        .map((seat) => {
          if (!('id' in seat)) return null;
          const peer = media?.peers.find(
            (peer) => peer.participantId === seat.id,
          );
          const identity = peer?.identity;
          const mediaTracks = tracks.filter(
            (track) => track.identity === identity,
          );
          const camera = mediaTracks.find((track) => track.source === 'camera');
          return (
            <figure
              key={seat.id}
              className="relative m-0 flex aspect-video min-w-0 items-center justify-center overflow-hidden rounded-xl bg-surface-stage text-stage-ink"
            >
              {camera && seat.kind === 'human' ? (
                <TrackElement track={camera} />
              ) : (
                <span
                  aria-hidden="true"
                  className="flex size-12 items-center justify-center rounded-round bg-hue-sky text-lg font-strong"
                >
                  {seat.label.slice(0, 2)}
                </span>
              )}
              <figcaption className="absolute right-2 bottom-1 left-2 truncate bg-scrim/60 px-1 text-sm">
                {seat.label}
                {seat.kind === 'bot' ? ' · AI' : ''}
                <span className="block text-xs">
                  {!peer
                    ? 'Microphone unavailable'
                    : !peer.microphone
                      ? 'Microphone closed'
                      : mediaTracks.some((track) => track.speaking)
                        ? 'Speaking'
                        : 'Microphone open'}
                </span>
              </figcaption>
              {mediaTracks
                .filter(
                  (track) => track.source === 'microphone' && !track.local,
                )
                .map((track) => (
                  <TrackElement
                    key={track.track.sid ?? identity}
                    track={track}
                  />
                ))}
            </figure>
          );
        })}
    </div>
  );
}
