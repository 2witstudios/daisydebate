import type { RecordingArchiveStore } from './archive';
import type { RecordingStore } from './ports';

/**
 * Where Recordings are stored. The tables land with this branch's one migration;
 * until then nothing is recorded, so every screen shows the honest "not recorded"
 * state and every write refuses. REC-1.1 replaces this file with the store over
 * PostgreSQL.
 */
export const recordingPersistence = (): RecordingStore &
  RecordingArchiveStore => ({
  request: async () => {
    throw new Error('Recording tables are not migrated');
  },
  find: async () => null,
  findByRound: async () => null,
  apply: async () => ({ kind: 'missing' }),
  claimDeletions: async () => [],
  deferDeletion: async () => undefined,
  listFailedBefore: async () => [],
  listArchive: async () => ({ rows: [], nextBefore: null }),
  countPublicArchive: async () => 0,
});
