import type { App } from '../../server/app';
import type { RecordingArchiveStore } from './archive';
import type { RecordingStore } from './ports';

/** Where Recordings are stored: PostgreSQL, through `@daisy/db`. */
export const recordingPersistence = ({
  database,
}: Pick<App, 'database'>): RecordingStore & RecordingArchiveStore => ({
  request: database.requestRecording,
  find: database.findRecording,
  findByRound: database.findRecordingByRound,
  apply: database.applyRecording,
  claimDeletions: database.claimRecordingDeletions,
  deferDeletion: database.deferRecordingDeletion,
  listFailedBefore: database.listFailedRecordingsBefore,
  sourcesRemain: database.recordingCaptures.sourcesRemain,
  listArchive: database.listRecordingArchive,
  countPublicArchive: database.countPublicRecordingArchive,
});
