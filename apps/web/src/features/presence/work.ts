import type { ProcessFeature } from '../../server/process-work';
import { onlinePresenceRetentionTarget } from './retention';

/** This feature in the web process: its retention targets. */
export const presenceInProcess: ProcessFeature = {
  retention: ({ app }) => [onlinePresenceRetentionTarget(app.redis)],
};
