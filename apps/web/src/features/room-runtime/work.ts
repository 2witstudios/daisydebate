import { roomCommandRetentionTarget } from './retention';
import { featureWork } from '../../server/feature-work';
import type { ProcessFeature, ProcessWork } from '../../server/process-work';
import { startRoomLifecycleMaintenance } from './maintenance-worker';

/** Room lifecycle maintenance (ISSUE-771). */
const startRoomWork = ({ app, waits }: ProcessWork) =>
  featureWork({
    roomMaintenance: startRoomLifecycleMaintenance({
      app,
      waits,
      reporter: app.reporter,
    }),
  });

/** This feature in the web process: its background work and its retention targets. */
export const roomInProcess: ProcessFeature = {
  work: startRoomWork,
  retention: ({ app }) => [roomCommandRetentionTarget(app.database)],
};
