import { featureWork, type ProcessWork } from '../../../server/feature-work';
import { startObservationPurges } from '../../../server/observation-purges';
import {
  privacyJobsQueue,
  startPrivacyJobs,
} from '../../../server/privacy-jobs';

/** An erasure's queued work, delivered, retried and recorded. */
export const startDataRightsWork = ({ app, waits }: ProcessWork) =>
  featureWork({
    // ISSUE-852: no cached copy of erased content outlives its job.
    observationPurges: startObservationPurges({
      deliver: app.database.deliverObservationPurges,
      owed: () => app.database.owedObservationPurges(),
      purgeAll: () => app.redis.purgeAllObservations(),
      clock: app.clock,
      logger: app.logger,
      waits,
    }),
    // ISSUE-833: no processor copy outlives its vendor deletion job.
    privacyJobs: startPrivacyJobs({
      ...privacyJobsQueue(app),
      clock: app.clock,
      logger: app.logger,
      waits,
    }),
  });
