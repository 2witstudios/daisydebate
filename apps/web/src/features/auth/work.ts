import type { ProcessFeature } from '../../server/process-work';
import {
  verificationRetentionTarget,
  sessionRetentionTarget,
  provisionalUserRetentionTarget,
} from './retention';
import { provisionalLinkPurposes } from './mail/provisional-mail';

/** This feature in the web process: its retention targets. */
export const authInProcess: ProcessFeature = {
  retention: ({ app }) => [
    verificationRetentionTarget(app.database),
    sessionRetentionTarget(app.database),
    provisionalUserRetentionTarget(app.database, provisionalLinkPurposes),
  ],
};
