import type { ProcessFeature } from '../../server/process-work';
import { outboxRetentionTarget } from './retention';

/** This feature in the web process: its retention targets. */
export const realtimeInProcess: ProcessFeature = {
  retention: ({ app }) => [outboxRetentionTarget(app.database)],
};
