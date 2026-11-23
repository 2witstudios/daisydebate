import type { ProcessFeature } from '../../server/process-work';
import { audienceReactionRetentionTarget } from './retention';

/** This feature in the web process: its retention targets. */
export const audienceReactionsInProcess: ProcessFeature = {
  retention: ({ app }) => [audienceReactionRetentionTarget(app.database)],
};
