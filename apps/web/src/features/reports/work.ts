import type { ProcessFeature } from '../../server/process-work';
import { reportRetentionTarget } from './retention';

/** This feature in the web process: its retention targets. */
export const reportsInProcess: ProcessFeature = {
  retention: ({ app }) => [reportRetentionTarget(app.database)],
};
