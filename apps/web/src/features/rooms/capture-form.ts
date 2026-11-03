import type { BroadcastReleasePolicy, RoomCapture } from '@daisy/protocol';

/** The host's release choices; a native select, so no script is needed. */
export const releaseChoices = [
  { value: 'delay:10', label: '10 seconds, the fastest' },
  { value: 'delay:60', label: '60 seconds, the default' },
  { value: 'delay:300', label: '5 minutes' },
  { value: 'delay:1800', label: '30 minutes' },
  { value: 'round_end', label: 'When the round ends' },
  { value: 'at', label: 'At a set time' },
] as const;

export const DEFAULT_RELEASE_CHOICE = 'delay:60';

const delayValue = /^delay:(\d{1,5})$/;
// `datetime-local` carries no zone and a form cannot send one without script,
// so the field says UTC and is read as UTC.
const utcMinute = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

const releasePolicy = (
  choice: unknown,
  at: unknown,
): BroadcastReleasePolicy | null => {
  if (choice === 'round_end') return { kind: 'round_end' };
  if (choice === 'at') {
    if (typeof at !== 'string' || !utcMinute.test(at)) return null;
    const atMs = Date.parse(`${at}:00.000Z`);
    return Number.isNaN(atMs) ? null : { kind: 'at', atMs };
  }
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
  const release = releasePolicy(fields.release, fields.releaseAt);
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

/** The select's value for a stored release; a set time keeps its own field. */
export const releaseChoiceOf = (release: BroadcastReleasePolicy): string =>
  release.kind === 'delay' ? `delay:${release.seconds}` : release.kind;

/** The `datetime-local` value for a set time, in the UTC the field states. */
export const releaseAtValue = (release: BroadcastReleasePolicy): string =>
  release.kind === 'at'
    ? new Date(release.atMs).toISOString().slice(0, 16)
    : '';

const releaseWords = (release: BroadcastReleasePolicy): string => {
  switch (release.kind) {
    case 'delay':
      return `with a ${release.seconds} second delay`;
    case 'round_end':
      return 'released when the round ends';
    case 'at':
      return `released at ${new Date(release.atMs).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
  }
};

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
