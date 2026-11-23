import type { ProcessFeature } from '../../server/process-work';
import { judgingRetentionTargets } from './retention';

/** This feature in the web process: its retention targets. */
export const roundJudgingInProcess: ProcessFeature = {
  retention: ({ app }) => [...judgingRetentionTargets(app.database)],
};
