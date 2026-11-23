import { featureWork, type ProcessWork } from '../../server/feature-work';
import { startBroadcastSweep } from './composition';

/** The broadcast control plane, inert unless BROADCAST_CAPTURE is on. */
export const startBroadcastWork = ({ app, waits, wakes }: ProcessWork) =>
  featureWork({
    broadcastSweep: startBroadcastSweep(app, waits, wakes.of('round')),
  });
