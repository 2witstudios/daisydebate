import type { ProcessFeature } from '../../server/process-work';
import { roundAnalysisRetentionTarget } from './retention';

/** This feature in the web process: its retention targets. */
export const roundAnalysisInProcess: ProcessFeature = {
  retention: ({ app }) => [roundAnalysisRetentionTarget(app.database)],
};
