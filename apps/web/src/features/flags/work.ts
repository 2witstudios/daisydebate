import type { ProcessFeature } from '../../server/process-work';
import { flagRetentionTargets } from './retention';

/** This feature in the web process: its retention targets. */
export const flagsInProcess: ProcessFeature = {
  retention: ({ app }) => [...flagRetentionTargets(app.database)],
};
