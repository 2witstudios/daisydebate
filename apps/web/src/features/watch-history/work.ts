import type { ProcessFeature } from '../../server/process-work';
import { watchHistoryRetentionTarget } from './retention';

/** This feature in the web process: its retention targets. */
export const watchHistoryInProcess: ProcessFeature = {
  retention: ({ app }) => [watchHistoryRetentionTarget(app.database)],
};
