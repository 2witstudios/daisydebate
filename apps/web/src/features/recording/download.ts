import { createAppError } from '@daisy/errors';
import {
  CONTENT_MODERATION_DELIVERY_BOUND_MS,
  type PovFileKind,
  type RecordingMedia,
} from '@daisy/protocol';
import {
  mayDownload,
  roundEvidencePermissions,
  type RecordingViewer,
} from './audience';
import type {
  RecordingInputs,
  RecordingObjectStore,
  RecordingStore,
} from './ports';

/** Long enough to start the file; a stale link past this is refused by storage. */
export const DOWNLOAD_LINK_SECONDS =
  CONTENT_MODERATION_DELIVERY_BOUND_MS / 1000;

/** Five files a Recording with two debaters, for several Recordings in an hour. */
export const recordingDownloadRule = { max: 30, windowSeconds: 3600 };

/** What can be asked for: the composite or a named file of one debater's view. */
export type RecordingDownloadChoice =
  | { readonly kind: 'composite' }
  | {
      readonly kind: 'pov';
      readonly roundParticipantId: string;
      readonly file: PovFileKind;
    };

/** Named by seat, never by a person, and looked up in the media: never a free key. */
const chosenFile = (
  recordingId: string,
  media: RecordingMedia,
  choice: RecordingDownloadChoice,
): { readonly key: string; readonly attachmentName: string } | null => {
  if (choice.kind === 'composite')
    return {
      key: media.downloadKey,
      attachmentName: `daisy-recording-${recordingId}.mp4`,
    };
  const pov = media.povs?.find(
    (entry) => entry.roundParticipantId === choice.roundParticipantId,
  );
  if (pov?.status !== 'built') return null;
  const file = choice.file === 'video' ? pov.video : pov.audio;
  return (
    file && {
      key: file.key,
      attachmentName: `daisy-recording-${recordingId}-${pov.roundParticipantId}.${choice.file === 'video' ? 'mp4' : 'm4a'}`,
    }
  );
};

/**
 * A short-lived link to the whole video or a debater's own file, for a subscriber
 * who may watch this Recording. Anything else answers as if there were nothing to download, so the
 * refusal says nothing about a Recording they cannot see.
 */
export const openDownload = async (
  deps: {
    readonly store: Pick<RecordingStore, 'find'>;
    readonly objects: Pick<RecordingObjectStore, 'signedRead'>;
    readonly inputs: Pick<
      RecordingInputs,
      'readRound' | 'readBroadcastRelease' | 'holdsRecordingDownload'
    >;
  },
  input: {
    readonly recordingId: string;
    readonly choice: RecordingDownloadChoice;
    readonly viewer: RecordingViewer;
    readonly presentedLinkHashOf: (roundId: string) => string | null;
  },
): Promise<string> => {
  const refused = createAppError('NOT_FOUND');
  if (input.viewer.kind !== 'account') throw refused;
  const record = await deps.store.find(input.recordingId);
  if (record === null) throw refused;
  const round = await deps.inputs.readRound(record.roundId);
  if (round === null) throw refused;
  const permissions = roundEvidencePermissions(
    round,
    await deps.inputs.readBroadcastRelease(round.id),
    input.viewer,
    input.presentedLinkHashOf(round.id),
  );
  const allowed = mayDownload({
    viewer: input.viewer,
    permissions,
    status: record.lifecycle.status,
    subscribed: await deps.inputs.holdsRecordingDownload(input.viewer.userId),
  });
  if (!allowed || record.lifecycle.status !== 'ready') throw refused;
  const file = chosenFile(record.id, record.lifecycle.media, input.choice);
  if (file === null) throw refused;
  return deps.objects.signedRead(file.key, {
    expiresInSeconds: DOWNLOAD_LINK_SECONDS,
    attachmentName: file.attachmentName,
  });
};
