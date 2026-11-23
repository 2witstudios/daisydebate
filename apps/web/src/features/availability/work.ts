import type { ProcessFeature } from '../../server/process-work';
import { availabilityRetentionTargets } from './retention';

/** This feature in the web process: its retention targets. */
export const availabilityInProcess: ProcessFeature = {
  retention: ({ app }) => [...availabilityRetentionTargets(app.database)],
};
