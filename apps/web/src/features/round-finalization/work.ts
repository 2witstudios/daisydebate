import { featureWork } from '../../server/feature-work';
import type { ProcessWork } from '../../server/process-work';
import { startRoundCompetitiveMaintenance } from './maintenance-worker';

/** A Round's competitive maintenance: finalization, attendance and ratings. */
export const startRoundFinalizationWork = ({
  app,
  instanceId,
  waits,
  wakes,
}: ProcessWork) =>
  featureWork({
    roundMaintenance: startRoundCompetitiveMaintenance({
      app,
      instanceId,
      waits,
      wake: wakes.of('round'),
      ratingWake: wakes.of('rating'),
      reporter: app.reporter,
    }),
  });
