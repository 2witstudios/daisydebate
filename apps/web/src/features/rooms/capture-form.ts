import type { BroadcastReleasePolicy, RoomCapture } from '@daisy/protocol';

/** The host's release choices; a native select, so no script is needed. */
export const releaseChoices = [
  { value: 'delay:10', label: '10 seconds, the fastest' },
  { value: 'delay:60', label: '60 seconds, the default' },
  { value: 'delay:300', label: '5 minutes' },
  { value: 'delay:1800', label: '30 minutes' },
] as const;

export const DEFAULT_RELEASE_CHOICE = 'delay:60';

const delayValue = /^delay:(\d{1,5})$/;
const releasePolicy = (choice: unknown): BroadcastReleasePolicy | null => {
  const delay = typeof choice === 'string' ? delayValue.exec(choice) : null;
  return delay ? { kind: 'delay', seconds: Number(delay[1]) } : null;
};

/**
 * Reads the native form into the command's capture, or null when the release
 * cannot be understood. An unticked box sends nothing, so absence is off.
 */
export function captureFromFields(
  fields: Record<string, unknown>,
): RoomCapture | null {
  const recording = fields.recording === 'on';
  if (fields.broadcast !== 'on') return { broadcast: null, recording };
  const release = releasePolicy(fields.release);
  return (
    release && {
      broadcast: {
        release,
        debatersReadChat: fields.debatersReadChat === 'on',
      },
      recording,
    }
  );
}

/** The select's value for a stored release. */
export const releaseChoiceOf = (release: BroadcastReleasePolicy): string =>
  `delay:${release.seconds}`;

const releaseWords = (release: BroadcastReleasePolicy): string =>
  `with a ${release.seconds} second delay`;

/** What this Room captures, in words every participant reads before Ready. */
export function captureLine(capture: RoomCapture): string {
  const broadcast = capture.broadcast
    ? `Broadcast ${releaseWords(capture.broadcast.release)}${
        capture.broadcast.debatersReadChat
          ? '; debaters can read spectator chat during the round'
          : '; debaters cannot read spectator chat during the round'
      }`
    : 'Not broadcast';
  return `${broadcast}. ${capture.recording ? 'Recorded' : 'Not recorded'}.`;
}
