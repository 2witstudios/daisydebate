import type { ProcessFeature } from '../../../server/process-work';
import { floorRetentionTargets } from './retention';

/** This feature in the web process: its retention targets. */
export const roundFloorInProcess: ProcessFeature = {
  retention: ({ app }) => [...floorRetentionTargets(app.database)],
};
