import type { SourceFailureKind } from './source-failure';
import { forgetCheckedDevices } from '../video/device-selection';
import type { Source } from './browser-transport';
import type { MediaConnectionState } from './media-controller';

const messages: Record<MediaConnectionState, string> = {
  connecting: 'Connecting camera and sound…',
  reconnecting: 'Reconnecting camera and sound…',
  live: 'Connected',
  'device-blocked':
    'Camera or microphone access is blocked. Check your browser permissions, then retry.',
  'device-missing':
    'Your checked camera or microphone is missing. Reconnect it, or retry to use your default device.',
  denied:
    'Camera and sound were refused for this Round. A fresh admission is needed; refresh the page or leave and return once admitted.',
  unavailable: 'Camera and sound are unavailable. Retry to reconnect.',
  ended: 'The call has ended.',
};

/** The honest kind of one source's current failure (ISSUE-881). */
export type SourceIllHealth = readonly [Source, SourceFailureKind];
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
} as const;

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
    return `Your camera and microphone ${joinKinds(bad, 'could not start')}.`;
  if (names.includes('microphone')) {
    const [, kind] = bad.find(([source]) => source === 'microphone')!;
    return `Your microphone ${illHealthWord[kind]}.`;
  }
  const [entry] = bad;
  if (!entry) return '';
  const [, kind] = entry;
  const cameraSentence = `Your camera ${illHealthWord[kind]}.`;
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

const joinKinds = (
  bad: readonly SourceIllHealth[],
  fallback: string,
): string => {
  const kinds = [...new Set(bad.map(([, kind]) => illHealthWord[kind]))];
  return kinds.length === 1 ? kinds[0]! : fallback;
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
  const baseMessage =
    connection === 'live' && gone
      ? `Connected, but your checked ${missing.join(' and ')} ${
          missing.length > 1 ? 'are' : 'is'
        } missing. Reconnect ${
          missing.length > 1 ? 'them' : 'it'
        }, or retry to use your default.`
      : messages[connection];
  const soundSentence =
    connection === 'live' && evidence.sound?.blocked
      ? 'Sound is blocked by your browser. Press Enable sound to play it.'
      : '';
  const healthSentence =
    connection === 'live' && illHealth.length > 0
      ? illHealthMessage(illHealth, microphone)
      : '';
  return {
    message: [
      gone ? baseMessage : messages[connection],
      soundSentence,
      healthSentence,
    ]
      .filter((part) => part !== '')
      .join(' '),
    retry:
      gone ||
      connection === 'unavailable' ||
      connection === 'device-blocked' ||
      connection === 'device-missing',
  };
}

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
  forget: typeof forgetCheckedDevices = forgetCheckedDevices,
): readonly Source[] {
  forget(roomId, missing, undefined, actorId);
  return [];
}
