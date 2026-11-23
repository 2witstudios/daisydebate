import { featureWork } from '../../server/feature-work';
import type { ProcessWork } from '../../server/process-work';
import { startRoomLifecycleMaintenance } from './maintenance-worker';

/** Room lifecycle maintenance (ISSUE-771). */
export const startRoomWork = ({ app, waits }: ProcessWork) =>
  featureWork({
    roomMaintenance: startRoomLifecycleMaintenance({
      app,
      waits,
      reporter: app.reporter,
    }),
  });
