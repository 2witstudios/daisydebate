import { createAppError } from '@daisy/errors';
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
export const DOWNLOAD_LINK_SECONDS = 60;

export const recordingDownloadRule = { max: 10, windowSeconds: 3600 };

/**
 * A short-lived link to the whole video, for a subscriber who may watch this
 * Recording. Anything else answers as if there were nothing to download, so the
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
  return deps.objects.signedRead(record.lifecycle.media.downloadKey, {
    expiresInSeconds: DOWNLOAD_LINK_SECONDS,
    attachmentName: `daisy-recording-${record.id}.mp4`,
  });
};
