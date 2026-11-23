import { featureWork } from '../../server/feature-work';
import type { ProcessWork } from '../../server/process-work';
import { startPhotoDeletions } from './photo/deletion-sweep';

/**
 * ADR 0143: a rejected, removed, withdrawn or erased profile photo's image
 * is deleted, then its row; storage outages leave the obligation owed.
 */
export const startProfileWork = ({ app, waits }: ProcessWork) =>
  featureWork({
    photoDeletions: startPhotoDeletions({
      store: {
        due: app.database.duePhotoDeletions,
        complete: app.database.completePhotoDeletion,
        defer: app.database.deferPhotoDeletion,
        owed: app.database.owedPhotoDeletions,
      },
      objects: app.profilePhotoObjects,
      clock: app.clock,
      logger: app.logger,
      waits,
    }),
  });
