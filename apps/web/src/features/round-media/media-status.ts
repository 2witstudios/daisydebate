import type { SourceFailureKind } from './source-failure';
import { forgetCheckedDevices } from '../video/device-selection';
import type { Source } from './browser-transport';
import type { MediaConnectionState } from './media-controller';
import type { MediaFailureKind } from './media-failure';

const messages: Record<MediaConnectionState, string> = {
  connecting: 'Connecting camera and sound…',
  reconnecting: 'Reconnecting camera and sound…',
  live: 'Connected',
  'out-of-date':
    'Connected, but camera and sound status may be out of date. Retry if this lasts.',
  unavailable: 'Camera and sound are unavailable. Retry to reconnect.',
  ended: 'The call has ended.',
};
const unavailableMessages: Record<MediaFailureKind, string> = {
  transient: 'Camera and sound are unavailable. Trying again…',
  definite: messages.unavailable,
  replaced:
    'This seat connected from another tab or device. Retry here to take it back, which disconnects that one.',
  refused:
    'Camera and sound were refused for this Round. A fresh admission is needed; refresh the page or leave and return once admitted.',
};

/** The transport is still up, whether or not a recent read confirms it. */
export const hasLiveTracks = (connection: MediaConnectionState) =>
  connection === 'live' || connection === 'out-of-date';

/** A released connection shows no last-known server media state. */
export const mediaWhile = <Media>(
  connection: MediaConnectionState,
  media: Media | null,
) => (hasLiveTracks(connection) ? media : null);

/** What the Round shows when its controller changes connection state. */
export const showConnection =
  <Media>(view: {
    readonly connection: (state: MediaConnectionState) => void;
    readonly media: (update: (current: Media | null) => Media | null) => void;
  }) =>
  (state: MediaConnectionState) => {
    view.connection(state);
    view.media((current) => mediaWhile(state, current));
  };

const connectionCaption: Record<MediaConnectionState, string | null> = {
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
  readonly connection: MediaConnectionState;
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
  if (input.granted === false) return 'Waiting for microphone permission';
  if (input.mine && input.ownMuted) return 'You muted your microphone';
  return input.remote?.microphonePublished
    ? 'No microphone subscription'
    : 'Microphone not publishing';
}

/** The honest kind of one source's current failure (ISSUE-881). */
export type SourceIllHealth = readonly [Source, SourceFailureKind | 'waiting'];
/** What this device actually knows about its own sound playback (ISSUE-881). */
type PlaybackEvidence = {
  /** The browser refused autoplay; only an explicit gesture can allow it. */
  readonly blocked: boolean;
};

/**
 * What this device actually knows about its own sources and playback right
 * now (ISSUE-881): a server grant alone is permission, a live track is
 * publication, a deliberate mute is neither loss nor health, and blocked
 * playback names itself instead of masquerading as a device failure.
 */
export type MediaEvidence = {
  /** Why the connection is unavailable, as the controller reported it. */
  readonly failure?: MediaFailureKind | null;
  readonly illHealth?: readonly SourceIllHealth[];
  readonly microphone?: MicrophoneEvidence | null;
  readonly sound?: PlaybackEvidence | null;
};

/** This device's own microphone: grant, publication, deliberate mute. */
export type MicrophoneEvidence = {
  /** The server's grant names the microphone; null before any state. */
  readonly granted: boolean | null;
  /** A local microphone track is actually published and live. */
  readonly published: boolean;
  /** The participant deliberately muted it; the track may still exist. */
  readonly muted: boolean;
};

const illHealthWord = {
  permission: 'access is denied',
  absence: 'is unavailable',
  failure: 'could not start',
  removal: 'could not be removed from the call',
  waiting: 'is waiting for your browser’s permission',
  'preference-unreadable': 'could not be read',
  'preference-invalid': 'is invalid',
} as const;

const isPreferenceFailure = (kind: SourceIllHealth[1]) =>
  kind === 'preference-unreadable' || kind === 'preference-invalid';
const sourceFailureMessage = ([source, kind]: SourceIllHealth) =>
  `${isPreferenceFailure(kind) ? `Your saved ${source} choice` : `Your ${source}`} ${illHealthWord[kind]}.`;

/**
 * One sentence naming exactly the failed sources, claiming nothing about
 * any source without its own evidence: a camera error never implies a
 * working microphone, and a grant never implies publication.
 */
const illHealthMessage = (
  bad: readonly SourceIllHealth[],
  microphone: MicrophoneEvidence | null,
): string => {
  const names = bad.map(([source]) => source);
  const both = names.includes('camera') && names.includes('microphone');
  if (both)
    return bad.some(([, kind]) => isPreferenceFailure(kind)) ||
      new Set(bad.map(([, kind]) => kind)).size > 1
      ? bad.map(sourceFailureMessage).join(' ')
      : `Your camera and microphone ${illHealthWord[bad[0]![1]].replace(/^is /, 'are ')}.`;
  if (names.includes('microphone')) {
    return sourceFailureMessage(
      bad.find(([source]) => source === 'microphone')!,
    );
  }
  const [entry] = bad;
  if (!entry) return '';
  const cameraSentence = sourceFailureMessage(entry);
  // Only evidence of a live, unmuted published microphone can say it stays live.
  if (microphone === null) return cameraSentence;
  if (!microphone.published)
    return microphone.granted
      ? `${cameraSentence} Your microphone is not publishing.`
      : cameraSentence;
  return microphone.muted
    ? `${cameraSentence} Your microphone is muted.`
    : `${cameraSentence} Your microphone stays live.`;
};

/** What the Round media bar says, and whether it offers Retry (ISSUE-573). */
export function mediaStatus(
  connection: MediaConnectionState,
  missing: readonly Source[],
  evidence: MediaEvidence = {},
) {
  const illHealth = evidence.illHealth ?? [];
  const microphone = evidence.microphone ?? null;
  const gone = missing.length > 0;
  const live = hasLiveTracks(connection);
  const failure = evidence.failure ?? 'definite';
  const baseMessage =
    live && gone
      ? `Connected, but ${connection === 'out-of-date' ? 'camera and sound status may be out of date, and ' : ''}your checked ${missing.join(' and ')} ${
          missing.length > 1 ? 'are' : 'is'
        } missing. Reconnect ${
          missing.length > 1 ? 'them' : 'it'
        }, or retry to use your default.`
      : connection === 'unavailable'
        ? unavailableMessages[failure]
        : messages[connection];
  const soundSentence =
    live && evidence.sound?.blocked
      ? 'Sound is blocked by your browser. Press Enable sound to play it.'
      : '';
  const healthSentence =
    live && illHealth.length > 0 ? illHealthMessage(illHealth, microphone) : '';
  return {
    message: [baseMessage, soundSentence, healthSentence]
      .filter((part) => part !== '')
      .join(' '),
    retry:
      (live && (gone || illHealth.length > 0)) ||
      connection === 'out-of-date' ||
      (connection === 'unavailable' && failure !== 'refused'),
  };
}

/** A saved choice nothing can read has no other repair: the press authorizes defaults. */
export const retryUsesDefaults = (illHealth: readonly SourceIllHealth[]) =>
  illHealth.some(([, kind]) => isPreferenceFailure(kind));

/**
 * An explicit Retry uses the browser default only for the checked devices
 * found gone; a checked device that still works keeps its choice. The forget
 * runs under the same principal whose check chose them (ISSUE-879), so the
 * reconnect after Retry captures the default instead of the same missing
 * device. Returns the cleared missing set.
 */
export function retryMissingDevices(
  roomId: string,
  missing: readonly Source[],
  actorId: string | null = null,
  forget: (
    roomId: string,
    missing: readonly Source[],
    actorId: string | null,
  ) => boolean = (room, sources, actor) =>
    forgetCheckedDevices(room, sources, undefined, actor),
): readonly Source[] {
  return forget(roomId, missing, actorId) ? [] : missing;
}
