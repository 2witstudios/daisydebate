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
export type SourceFailureKind = 'permission' | 'absence' | 'failure';

/** Classifies one transport-reported source error; permission names itself. */
export function classifySourceFailure(error: unknown): SourceFailureKind {
  const name =
    error instanceof Error ? error.name : (error?.constructor?.name ?? 'none');
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'permission';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'absence';
    default:
      return 'failure';
  }
}

const illHealthWord = {
  permission: 'access is denied',
  absence: 'is unavailable',
  failure: 'could not start',
} as const;

/** One sentence: the failed sources named alone, not a whole call report. */
const illHealthMessage = (bad: readonly SourceIllHealth[]): string => {
  const [first] = bad;
  if (bad.length === 1 && first) {
    const [source, kind] = first;
    const word = illHealthWord[kind];
    return source === 'camera'
      ? `Your camera ${word}. Your microphone stays live.`
      : `Your microphone ${word}. Other media keeps working.`;
  }
  return `Your camera and microphone ${bad
    .map((entry) => illHealthWord[entry[1]])
    .join(' and ')}.`;
};

/** What the Round media bar says, and whether it offers Retry (ISSUE-573). */
export function mediaStatus(
  connection: MediaConnectionState,
  missing: readonly Source[],
  illHealth: readonly SourceIllHealth[] = [],
) {
  const gone = missing.length > 0;
  const baseMessage =
    connection === 'live' && gone
      ? `Connected, but your checked ${missing.join(' and ')} ${
          missing.length > 1 ? 'are' : 'is'
        } missing. Reconnect ${
          missing.length > 1 ? 'them' : 'it'
        }, or retry to use your default.`
      : messages[connection];
  return {
    message:
      connection === 'live' && illHealth.length > 0
        ? `${gone ? baseMessage : messages.live} ${illHealthMessage(illHealth)}`.trim()
        : baseMessage,
    retry:
      gone ||
      connection === 'unavailable' ||
      connection === 'device-blocked' ||
      connection === 'device-missing',
  };
}

/**
 * An explicit Retry uses the browser default only for the checked devices
 * found gone; a checked device that still works keeps its choice. Returns
 * the cleared missing set.
 */
export function retryMissingDevices(
  roomId: string,
  missing: readonly Source[],
  forget: typeof forgetCheckedDevices = forgetCheckedDevices,
): readonly Source[] {
  forget(roomId, missing);
  return [];
}
