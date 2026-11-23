import type { ProcessFeature } from '../../server/process-work';
import { roomInvitationRetentionTarget } from './retention';

/** This feature in the web process: its retention targets. */
export const roomInvitationsInProcess: ProcessFeature = {
  retention: ({ app }) => [roomInvitationRetentionTarget(app.database)],
};
