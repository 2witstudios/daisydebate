import type { ProcessFeature } from '../../server/process-work';
import { challengeRetentionTarget } from './retention';

/** This feature in the web process: its retention targets. */
export const challengesInProcess: ProcessFeature = {
  retention: ({ app }) => [challengeRetentionTarget(app.database)],
};
