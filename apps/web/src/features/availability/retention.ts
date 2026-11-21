import type { Database } from '@daisy/db';
import {
  DAY_MS,
  retentionAfter,
  type RetentionTarget,
} from '../../server/retention-target';

export const availabilityRetentionTargets = (
  database: Pick<
    Database,
    'purgeExpiredServiceInstances' | 'purgeExpiredAvailabilitySamples'
  >,
): readonly RetentionTarget[] => [
  retentionAfter('service_instances', DAY_MS, (batch) =>
    database.purgeExpiredServiceInstances(batch),
  ),
  retentionAfter('availability_samples', DAY_MS, (batch) =>
    database.purgeExpiredAvailabilitySamples(batch),
  ),
];
