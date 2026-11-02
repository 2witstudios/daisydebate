'use client';
import { Fragment, useEffect, useRef } from 'react';
import type { RoundView, RoundMediaState } from '@daisy/protocol';
import type { TrackHandle } from './adapters/livekit-room';
import type { ObservedPeer, ObservedTrack } from './model/media-state';
import type { MediaConnectionLabel } from './model/media-status';
import { seatMicrophoneCaption } from './model/seat-caption';

function TrackElement({
  observed,
  handle,
}: {
  readonly observed: ObservedTrack;
  readonly handle: TrackHandle;
}) {
  const element = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const mediaTrack = handle.track;
  useEffect(() => {
    const node = element.current;
    if (!node) return;
    mediaTrack.attach(node);
    return () => {
      mediaTrack.detach(node);
      node.srcObject = null;
    };
  }, [mediaTrack]);
  return observed.source === 'camera' ? (
    <video
      ref={element}
      autoPlay
      playsInline
      muted={observed.local}
      className="h-full w-full object-cover"
      aria-label={observed.local ? 'Your camera' : 'Participant camera'}
    />
  ) : (
    <audio ref={element} autoPlay aria-label="Participant audio" />
  );
}

/** Only named debaters become tiles; a hidden judge never enters the identity map. */
export function MediaStage({
  view,
  connection,
  media,
  microphoneConfirmed,
  tracks,
  handles,
  ownIdentity,
  ownMuted,
  remotePeers,
}: {
  readonly view: RoundView;
  readonly connection: MediaConnectionLabel;
  readonly media: RoundMediaState | null;
  /** False from a supersession until the next answer is applied. */
  readonly microphoneConfirmed: boolean;
  /** What the model says is there. Every decision on this stage reads these. */
  readonly tracks: readonly ObservedTrack[];
  /** How to attach what the model says is there, and nothing more. */
  readonly handles: readonly TrackHandle[];
  /** The signed-in member's own media identity, or null for a viewer. */
  readonly ownIdentity: string | null;
  /** My own deliberate mute choice; presence remains separately observed. */
  readonly ownMuted: boolean;
  /** Peers the media room observes now; a grant never implies presence. */
  readonly remotePeers: readonly ObservedPeer[];
}) {
  const attached = (observed: ObservedTrack) => {
    const handle = handles.find(
      (candidate) =>
        candidate.identity === observed.identity &&
        candidate.source === observed.source,
    );
    return handle ? <TrackElement observed={observed} handle={handle} /> : null;
  };
  return (
    <div
      data-room-media="grid"
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
          const camera = mediaTracks.find(
            (track) => track.source === 'camera' && !track.muted,
          );
          const microphoneTrack = mediaTracks.find(
            (track) => track.source === 'microphone',
          );
          const mine = identity !== null && identity === ownIdentity;
          return (
            <figure
              key={seat.id}
              data-room-media="tile"
              className="relative m-0 flex aspect-video min-w-0 items-center justify-center overflow-hidden rounded-xl bg-surface-stage text-stage-ink"
            >
              {(camera && seat.kind === 'human' && attached(camera)) || (
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
                  {seatMicrophoneCaption({
                    connection,
                    confirmed: microphoneConfirmed,
                    track: microphoneTrack,
                    mine,
                    ownMuted,
                    granted: peer?.microphone,
                    remote:
                      identity === undefined
                        ? null
                        : remotePeers.find(
                            (remote) => remote.identity === identity,
                          ),
                  })}
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
                  <Fragment key={track.identity}>{attached(track)}</Fragment>
                ))}
            </figure>
          );
        })}
    </div>
  );
}
