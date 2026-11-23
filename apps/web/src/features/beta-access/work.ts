import { featureWork } from '../../server/feature-work';
import type { ProcessFeature, ProcessWork } from '../../server/process-work';
import { startBetaMail } from './mail-worker';

/** The durable beta mail (ADR 0075). */
const startBetaAccessWork = ({ app, waits }: ProcessWork) =>
  featureWork({
    betaMail: startBetaMail({ app, waits, reporter: app.reporter }),
  });

/** This feature in the web process: its background work. */
export const betaAccessInProcess: ProcessFeature = {
  work: startBetaAccessWork,
};
