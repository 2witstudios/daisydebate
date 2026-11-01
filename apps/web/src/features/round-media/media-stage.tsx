'use client';
import { useEffect, useRef } from 'react';
import type { RoundView, RoundMediaState } from '@daisy/protocol';
import type { MediaConnectionState } from './media-controller';
import type { MediaTrack } from './browser-transport';

function TrackElement({ track }: { readonly track: MediaTrack }) {
  const element = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const mediaTrack = track.track;
  useEffect(() => {
    const node = element.current;
    if (!node) return;
    mediaTrack.attach(node);
    return () => {
      mediaTrack.detach(node);
      node.srcObject = null;
    };
  }, [mediaTrack]);
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

/**
 * An honest caption for one seat: an actual track speaks, but silence, the
 * media transport still establishing, or a missing publication each say
 * exactly what they are (ISSUE-881). No grant implies a working microphone.
 */
const connectionCaption: Record<MediaConnectionState, string | null> = {
  connecting: 'Media is connecting…',
  reconnecting: 'Media is reconnecting…',
  live: null,
  'device-missing': 'Checked device missing',
  'device-blocked': 'Camera or microphone blocked',
  denied: 'Media refused',
  unavailable: 'Media unavailable',
  ended: 'Call ended',
};

const captionOf = (
  connection: MediaConnectionState,
  mine: boolean,
  ownMuted: boolean,
  granted: boolean | undefined,
): string => {
  const caption = connectionCaption[connection];
  if (caption !== null) return caption;
  if (granted === false) return 'Waiting for microphone permission';
  if (mine && ownMuted) return 'You muted your microphone';
  return mine ? 'Microphone not publishing' : 'No microphone subscription';
};

/** Only named debaters become tiles; a hidden judge never enters the identity map. */
export function MediaStage({
  view,
  media,
  tracks,
  connection,
  ownIdentity,
  ownMuted,
}: {
  readonly view: RoundView;
  readonly media: RoundMediaState | null;
  readonly tracks: readonly MediaTrack[];
  readonly connection: MediaConnectionState;
  /** The signed-in member's own media identity, or null for a viewer. */
  readonly ownIdentity: string | null;
  /** My own microphone is deliberately muted and thus absent from tracks. */
  readonly ownMuted: boolean;
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
          const microphoneTrack = mediaTracks.find(
            (track) => track.source === 'microphone',
          );
          const mine = identity !== null && identity === ownIdentity;
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
                  {microphoneTrack && !microphoneTrack.muted
                    ? microphoneTrack.speaking
                      ? 'Speaking'
                      : 'Microphone open'
                    : microphoneTrack?.muted && !mine
                      ? 'Microphone muted'
                      : captionOf(connection, mine, ownMuted, peer?.microphone)}
                </span>
              </figcaption>
              {mediaTracks
                .filter(
                  (track) =>
                    track.source === 'microphone' &&
                    !track.local &&
                    !track.muted,
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
