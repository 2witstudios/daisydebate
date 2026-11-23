import { featureWork, type ProcessWork } from '../../server/feature-work';
import { startRoomLifecycleMaintenance } from '../../server/room-maintenance';

/** Room lifecycle maintenance (ISSUE-771). */
export const startRoomWork = ({ app, waits }: ProcessWork) =>
  featureWork({
    roomMaintenance: startRoomLifecycleMaintenance({
      app,
      waits,
      reporter: app.reporter,
    }),
  });
