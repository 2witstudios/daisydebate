import { featureWork } from '../../server/feature-work';
import type { ProcessWork } from '../../server/process-work';
import { startMessagingFileMaintenance } from './files/maintenance-worker';

/** Message attachment maintenance, only when explicitly configured. */
export const startMessagingWork = ({ app, waits }: ProcessWork) => {
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
