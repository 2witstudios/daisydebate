import { featureWork } from '../../server/feature-work';
import type { ProcessFeature, ProcessWork } from '../../server/process-work';
import { startRoundCompetitiveMaintenance } from './maintenance-worker';

/** A Round's competitive maintenance: finalization, attendance and ratings. */
const startRoundFinalizationWork = ({
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

/** This feature in the web process: its background work. */
export const roundFinalizationInProcess: ProcessFeature = {
  work: startRoundFinalizationWork,
};
