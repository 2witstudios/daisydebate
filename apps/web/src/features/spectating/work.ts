import { spectatorChatRetentionTarget } from './retention';
import { featureWork } from '../../server/feature-work';
import type { ProcessFeature, ProcessWork } from '../../server/process-work';
import { startNotificationSweep } from './audience-composition';

/** The audience's notification sweep. */
const startSpectatingWork = ({ app, waits }: ProcessWork) =>
  featureWork({ notificationSweep: startNotificationSweep(app, waits) });

/** This feature in the web process: its background work and its retention targets. */
export const spectatingInProcess: ProcessFeature = {
  work: startSpectatingWork,
  retention: ({ app }) => [spectatorChatRetentionTarget(app.database)],
};
