import { featureWork } from '../../server/feature-work';
import type { ProcessWork } from '../../server/process-work';
import { startNotificationSweep } from './audience-composition';

/** The audience's notification sweep. */
export const startSpectatingWork = ({ app, waits }: ProcessWork) =>
  featureWork({ notificationSweep: startNotificationSweep(app, waits) });
