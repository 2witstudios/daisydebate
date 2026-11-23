import { featureWork } from '../../server/feature-work';
import type { ProcessWork } from '../../server/process-work';
import { startBetaMail } from './mail-worker';

/** The durable beta mail (ADR 0075). */
export const startBetaAccessWork = ({ app, waits }: ProcessWork) =>
  featureWork({
    betaMail: startBetaMail({ app, waits, reporter: app.reporter }),
  });
