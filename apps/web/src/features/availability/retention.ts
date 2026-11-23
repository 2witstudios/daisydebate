import type { AvailabilityStore } from '@daisy/db/stores/availability';
import {
  DAY_MS,
  retentionAfter,
  type RetentionTarget,
} from '../../server/retention-target';

export const availabilityRetentionTargets = (
  database: Pick<
    AvailabilityStore,
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
