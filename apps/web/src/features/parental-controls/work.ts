import type { ProcessFeature } from '../../server/process-work';
import { childAccountRequestRetentionTarget } from './retention';

/** This feature in the web process: its retention targets. */
export const parentalControlsInProcess: ProcessFeature = {
  retention: ({ app }) => [childAccountRequestRetentionTarget(app.database)],
};
