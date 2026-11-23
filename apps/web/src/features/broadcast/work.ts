import { featureWork } from '../../server/feature-work';
import type { ProcessFeature, ProcessWork } from '../../server/process-work';
import { startBroadcastSweep } from './composition';

/** The broadcast control plane, inert unless BROADCAST_CAPTURE is on. */
const startBroadcastWork = ({ app, waits, wakes }: ProcessWork) =>
  featureWork({
    broadcastSweep: startBroadcastSweep(app, waits, wakes.of('round')),
  });

/** This feature in the web process: its background work. */
export const broadcastInProcess: ProcessFeature = {
  work: startBroadcastWork,
};
