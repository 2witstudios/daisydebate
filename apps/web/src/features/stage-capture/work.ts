import { featureWork } from '../../server/feature-work';
import type { ProcessFeature, ProcessWork } from '../../server/process-work';
import { startStrayEgressSweep, stopStageMedia } from './composition';

/** Stray egress clean-up when a capture switch is on, and the stage's node probe. */
const startStageCaptureWork = ({ app, waits }: ProcessWork) =>
  featureWork({
    strayEgressSweep: startStrayEgressSweep(app, waits),
    stageMedia: { stop: () => stopStageMedia(app) },
  });

/** This feature in the web process: its background work. */
export const stageCaptureInProcess: ProcessFeature = {
  work: startStageCaptureWork,
};
