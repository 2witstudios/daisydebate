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
  unavailable: 'Camera and sound are unavailable. Retry to reconnect.',
  ended: 'The call has ended.',
};

/** What the Round media bar says, and whether it offers Retry (ISSUE-573). */
export function mediaStatus(
  connection: MediaConnectionState,
  missing: readonly Source[],
) {
  const gone = missing.length > 0;
  return {
    message:
      connection === 'live' && gone
        ? `Connected, but your checked ${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} missing. Reconnect ${missing.length > 1 ? 'them' : 'it'}, or retry to use your default.`
        : messages[connection],
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
