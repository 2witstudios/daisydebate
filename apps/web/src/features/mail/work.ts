import type { ProcessFeature } from '../../server/process-work';
import {
  deliveryRetentionTargets,
  mailIntentRetentionTarget,
} from './retention';

/** This feature in the web process: its retention targets. */
export const mailInProcess: ProcessFeature = {
  retention: ({ app }) => [
    ...deliveryRetentionTargets(app.database),
    mailIntentRetentionTarget(app.database),
  ],
};
