import { plannedRecording } from '@daisy/debate-engine';
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
  applyParticipantRemoval: database.applyParticipantRemoval,
  claimDeletions: database.claimRecordingDeletions,
  deferDeletion: database.deferRecordingDeletion,
  listFailedBefore: database.listFailedRecordingsBefore,
  listEndedEvidenceHolds: database.listEndedRecordingEvidenceHolds,
  sourcesRemain: database.recordingCaptures.sourcesRemain,
  listArchive: async (input) => {
    const page = await database.listRecordingArchive(input);
    return {
      nextBefore: page.nextBefore,
      rows: page.rows.map(({ capture, youthRound, youthPublic, ...row }) => ({
        ...row,
        recordingPolicy: plannedRecording({
          competitionType: row.competitionType,
          capture,
        }),
        // A private one is listed to a seated viewer only, so no linked adult
        // is needed; a shared one is listed to everyone (ADR 0151).
        youth: youthRound ? { debaters: [], public: youthPublic } : null,
      })),
    };
  },
  countPublicArchive: database.countPublicRecordingArchive,
});
