import type { ProcessFeature } from '../../server/process-work';
import { checkInRetentionTarget } from './retention';

/** This feature in the web process: its retention targets. */
export const attendanceInProcess: ProcessFeature = {
  retention: ({ app }) => [checkInRetentionTarget(app.database)],
};
