import { featureWork, type ProcessWork } from '../../server/feature-work';
import { startRoundCompetitiveMaintenance } from '../../server/round-maintenance';

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
