import type { ProcessFeature } from '../../server/process-work';
import { seatInvitationRetentionTarget } from './retention';

/** This feature in the web process: its retention targets. */
export const clubsInProcess: ProcessFeature = {
  retention: ({ app }) => [seatInvitationRetentionTarget(app.database)],
};
