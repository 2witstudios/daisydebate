import type { BroadcastReleasePolicy } from '@daisy/protocol/broadcast';
import type {
  RecordingPolicy,
  RoomCapture,
} from '@daisy/protocol/room-capture';

/** The host's recording release choices. */
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
 * The ordinary form's one Recording box: ticked releases the Recording as
 * Daisy releases any, unticked records nothing. It never offers a Recording
 * kept for the officials (TAB-6.15).
 */
export const recordingPolicyFromBox = (box: unknown): RecordingPolicy =>
  box === 'on' ? 'released' : 'off';

/**
 * Reads the native form into the command's capture, or null when the release
 * cannot be understood. An unticked box sends nothing, so absence is off.
 */
export function captureFromFields(
  fields: Record<string, unknown>,
): RoomCapture | null {
  const recordingPolicy = recordingPolicyFromBox(fields.recording);
  if (fields.broadcast !== 'on') return { broadcast: null, recordingPolicy };
  const release = releasePolicy(fields.release);
  return (
    release && {
      broadcast: {
        release,
        debatersReadChat: fields.debatersReadChat === 'on',
      },
      recordingPolicy,
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
  return `${broadcast}. ${recordingWords(capture.recordingPolicy)}.`;
}

const recordingWords = (policy: RecordingPolicy): string => {
  switch (policy) {
    case 'off':
      return 'Not recorded';
    case 'officials':
      return 'Recorded for the judges, the moderator and the host only';
    case 'released':
      return 'Recorded';
  }
};
