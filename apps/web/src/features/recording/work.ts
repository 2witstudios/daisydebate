import { featureWork } from '../../server/feature-work';
import type { ProcessFeature, ProcessWork } from '../../server/process-work';
import { startRecordingDeletions } from './deletions-worker';
import { startRecordingCapture } from './composition';
import { recordingPersistence } from './persistence';

/** Recording deletions, and capture when it is switched on. */
const startRecordingWork = ({ app, waits, wakes }: ProcessWork) =>
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

/** This feature in the web process: its background work. */
export const recordingInProcess: ProcessFeature = {
  work: startRecordingWork,
};
