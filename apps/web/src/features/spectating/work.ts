import { featureWork, type ProcessWork } from '../../server/feature-work';
import { startNotificationSweep } from './audience-composition';

/** The audience's notification sweep. */
export const startSpectatingWork = ({ app, waits }: ProcessWork) =>
  featureWork({ notificationSweep: startNotificationSweep(app, waits) });
