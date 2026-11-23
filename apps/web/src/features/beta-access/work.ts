import { featureWork, type ProcessWork } from '../../server/feature-work';
import { startBetaMail } from './mail-worker';

/** The durable beta mail (ADR 0075). */
export const startBetaAccessWork = ({ app, waits }: ProcessWork) =>
  featureWork({
    betaMail: startBetaMail({ app, waits, reporter: app.reporter }),
  });
