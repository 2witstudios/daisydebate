import type { ProcessFeature } from '../../server/process-work';
import { moderationRetentionTarget } from './retention';

/** This feature in the web process: its retention targets. */
export const moderationInProcess: ProcessFeature = {
  retention: ({ app }) => [moderationRetentionTarget(app.database)],
};
