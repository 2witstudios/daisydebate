import type { ProcessFeature } from '../../server/process-work';
import { contactRetentionTargets } from './retention';

/** This feature in the web process: its retention targets. */
export const contactsInProcess: ProcessFeature = {
  retention: ({ app }) => [...contactRetentionTargets(app.database)],
};
