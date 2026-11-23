import { featureWork, type ProcessWork } from '../../server/feature-work';
import { startRecordingDeletions } from '../../server/recording-deletions';
import { startRecordingCapture } from './composition';
import { recordingPersistence } from './persistence';

/** Recording deletions, and capture when it is switched on. */
export const startRecordingWork = ({ app, waits, wakes }: ProcessWork) =>
  featureWork({
    recordingDeletions: startRecordingDeletions({
      store: recordingPersistence(app),
      objects: app.recordingObjects,
      owner: app.ids.next(),
      clock: app.clock,
      logger: app.logger,
      waits,
    }),
    recordingCapture: startRecordingCapture(app, waits, wakes.of('round')),
  });
