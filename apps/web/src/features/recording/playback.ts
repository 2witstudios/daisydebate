import { createAppError } from '@daisy/errors';
import { CONTENT_MODERATION_DELIVERY_BOUND_MS } from '@daisy/protocol';
import { roundEvidencePermissions, type RecordingViewer } from './audience';
import type {
  RecordingInputs,
  RecordingObjectStore,
  RecordingStore,
} from './ports';

/**
 * A signed read lasts no longer than DEC-303 allows a viewer to keep access
 * after a takedown, and every new request is authorized again.
 */
export const PLAYBACK_GRANT_SECONDS =
  CONTENT_MODERATION_DELIVERY_BOUND_MS / 1000;

const FILE_NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}$/;
const MEDIA_FILE = /\.(m3u8|ts|m4s|mp4|vtt)$/;

/** Zero trust: only plain media file names, so a path never leaves the HLS tree. */
const validPath = (path: readonly string[]): boolean =>
  path.length > 0 &&
  path.length <= 4 &&
  path.every((part) => FILE_NAME.test(part) && !part.includes('..')) &&
  MEDIA_FILE.test(path.at(-1) ?? '');

export type PlaybackAnswer =
  | { readonly kind: 'playlist'; readonly text: string }
  | { readonly kind: 'redirect'; readonly url: string };

/**
 * One authorized read of a Recording's HLS. Playlists are answered here so their
 * relative paths keep coming back through this check; media redirects to a
 * short-lived signed read of the private bucket.
 */
export const openPlayback = async (
  deps: {
    readonly store: Pick<RecordingStore, 'find'>;
    readonly objects: Pick<RecordingObjectStore, 'signedRead' | 'readText'>;
    readonly inputs: Pick<
      RecordingInputs,
      'readRound' | 'readBroadcastRelease'
    >;
  },
  input: {
    readonly recordingId: string;
    readonly path: readonly string[];
    readonly viewer: RecordingViewer;
    readonly presentedLinkHashOf: (roundId: string) => string | null;
  },
): Promise<PlaybackAnswer> => {
  const refused = createAppError('NOT_FOUND');
  if (!validPath(input.path)) throw refused;
  const record = await deps.store.find(input.recordingId);
  if (record === null || record.lifecycle.status !== 'ready') throw refused;
  const round = await deps.inputs.readRound(record.roundId);
  if (round === null) throw refused;
  const permissions = roundEvidencePermissions(
    round,
    await deps.inputs.readBroadcastRelease(round.id),
    input.viewer,
    input.presentedLinkHashOf(round.id),
  );
  if (!permissions.media) throw refused;
  const { playlistKey } = record.lifecycle.media;
  const root = playlistKey.slice(0, playlistKey.lastIndexOf('/') + 1);
  const key = `${root}${input.path.join('/')}`;
  return key.endsWith('.m3u8')
    ? { kind: 'playlist', text: await deps.objects.readText(key) }
    : {
        kind: 'redirect',
        url: deps.objects.signedRead(key, {
          expiresInSeconds: PLAYBACK_GRANT_SECONDS,
        }),
      };
};
