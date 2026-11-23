import { featureWork } from '../../../server/feature-work';
import type { ProcessFeature, ProcessWork } from '../../../server/process-work';
import { startObservationPurges } from './observation-purges';
import { privacyJobsQueue, startPrivacyJobs } from './privacy-jobs';

/** An erasure's queued work, delivered, retried and recorded. */
const startDataRightsWork = ({ app, waits }: ProcessWork) =>
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

/** This feature in the web process: its background work. */
export const dataRightsInProcess: ProcessFeature = {
  work: startDataRightsWork,
};
