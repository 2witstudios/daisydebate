import type { ProcessFeature } from '../../../server/process-work';
import { roomCommunityRetentionTargets } from './retention';

/** This feature in the web process: its retention targets. */
export const roomCommunityInProcess: ProcessFeature = {
  retention: ({ app }) => [...roomCommunityRetentionTargets(app.database)],
};
