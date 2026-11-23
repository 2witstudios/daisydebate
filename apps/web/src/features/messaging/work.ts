import { unreadMailRetentionTarget } from './retention';
import { featureWork } from '../../server/feature-work';
import type { ProcessFeature, ProcessWork } from '../../server/process-work';
import { startMessagingFileMaintenance } from './files/maintenance-worker';

/** Message attachment maintenance, only when explicitly configured. */
const startMessagingWork = ({ app, waits }: ProcessWork) => {
  const fileRuntime = app.messagingFiles;
  return featureWork({
    fileMaintenance: fileRuntime?.maintenance
      ? startMessagingFileMaintenance({
          maintenance: app.database.messagingFileMaintenance,
          config: fileRuntime.maintenance,
          remove: (key) => fileRuntime.objects.remove(key),
          clock: app.clock,
          logger: app.logger,
          waits,
        })
      : null,
  });
};

/** This feature in the web process: its background work and its retention targets. */
export const messagingInProcess: ProcessFeature = {
  work: startMessagingWork,
  retention: ({ app }) => [unreadMailRetentionTarget(app.database)],
};
