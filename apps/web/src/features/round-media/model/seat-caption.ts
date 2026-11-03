import type { MediaConnectionLabel } from './media-status';

const connectionCaption: Record<MediaConnectionLabel, string | null> = {
  connecting: 'Media is connecting…',
  reconnecting: 'Media is reconnecting…',
  live: null,
  'out-of-date': 'Microphone status out of date',
  unavailable: 'Media unavailable',
  ended: 'Call ended',
};

/**
 * An honest caption for one seat (ISSUE-881). A real track speaks for itself. All
 * else names what it is, and no grant implies a working microphone. A grant can
 * move at LiveKit before its reply is applied here, so one is read only while the
 * last answer is current. Checking cannot stick: an answer overdue past the read
 * budget makes the connection out of date.
 */
export function seatMicrophoneCaption(input: {
  readonly connection: MediaConnectionLabel;
  readonly confirmed: boolean;
  readonly track:
    { readonly muted: boolean; readonly speaking: boolean } | undefined;
  readonly mine: boolean;
  readonly ownMuted: boolean;
  readonly granted: boolean | undefined;
  /** Null when this seat has no media identity to observe, such as an AI seat. */
  readonly remote: { readonly microphonePublished: boolean } | undefined | null;
}) {
  if (input.track && !input.track.muted)
    return input.track.speaking ? 'Speaking' : 'Microphone open';
  if (input.track?.muted && !input.mine) return 'Microphone muted';
  const caption = connectionCaption[input.connection];
  if (caption !== null) return caption;
  if (!input.mine && input.remote === undefined)
    return 'Disconnected from media';
  if (!input.confirmed) return 'Checking microphone…';
  if (input.granted === false) return 'Microphone closed';
  if (input.mine && input.ownMuted) return 'You muted your microphone';
  return input.remote?.microphonePublished
    ? 'No microphone subscription'
    : 'Microphone not publishing';
}
