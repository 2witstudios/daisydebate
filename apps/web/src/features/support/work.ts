import { supportMessageRetentionTarget } from './retention';
import { featureWork } from '../../server/feature-work';
import type { ProcessFeature, ProcessWork } from '../../server/process-work';
import { startSupportMail } from './mail-worker';

/** Support message email; nothing without an owner address. */
const startSupportWork = ({ app, waits }: ProcessWork) =>
  featureWork({
    supportMail: startSupportMail({ app, waits, reporter: app.reporter }),
  });

/** This feature in the web process: its background work and its retention target. */
export const supportInProcess: ProcessFeature = {
  work: startSupportWork,
  retention: ({ app }) => [supportMessageRetentionTarget(app.database)],
};
