import type { RecordingMedia } from '@daisy/protocol';
import type { RecordingRound, RecordingViewer } from './audience';
import { fakeObjectStore, fakeRecordingStore } from './fake-store.test-support';
import type { RecordingRecord } from './ports';

export const at = '2026-11-02T10:00:00.000Z';
export const nowMs = Date.parse(at);
export const prefix = 'recordings/rec/';
const media: RecordingMedia = {
  playlistKey: `${prefix}hls/master.m3u8`,
  downloadKey: `${prefix}video.mp4`,
  durationMs: 60_000,
  byteSize: 10,
  verifiedAt: at,
  gaps: [],
  speeches: [],
};
export const ready = {
  status: 'ready' as const,
  capture: {
    egressId: 'EG',
    startedAt: at,
    endedAt: at,
    sourceKey: `${prefix}s`,
  },
  media,
};
export const record = (
  over: Partial<RecordingRecord> = {},
): RecordingRecord => ({
  id: 'rec',
  roundId: 'round',
  class: 'casual',
  eligibility: { kind: 'host_opt_in', hostActorId: 'host' },
  lifecycle: ready,
  version: 3,
  ...over,
});
export const round: RecordingRound = {
  id: 'round',
  competitionType: 'casual',
  visibility: 'public',
  hostActorId: 'host',
  completedAtMs: nowMs,
  seatedActorIds: ['aff', 'neg'],
};
export const account = (actorId: string): RecordingViewer => ({
  kind: 'account',
  userId: `u-${actorId}`,
  actorId,
});
export const visitor: RecordingViewer = { kind: 'visitor' };

export const deps = (
  seed = record(),
  over: { round?: RecordingRound; subscribed?: boolean } = {},
) => {
  const fake = fakeRecordingStore([seed]);
  const objects = fakeObjectStore([], {
    texts: { [`${prefix}hls/master.m3u8`]: '#EXTM3U' },
  });
  return {
    ...fake,
    objects: objects.store,
    inputs: {
      readRound: async () => over.round ?? round,
      readBroadcastRelease: async () =>
        ({
          releasedThroughMs: Number.MAX_SAFE_INTEGER,
          stopped: false,
        }) as const,
      holdsRecordingDownload: async () => over.subscribed ?? true,
    },
  };
};
