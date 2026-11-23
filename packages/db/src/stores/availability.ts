import { availabilityOperations } from '../availability-operations';
import { resourcesOf } from '../resource-handles';
import type { DatabaseResources } from '../resources';
import { namedLaneOperations } from '../workload';

/** Service instances' leases and the availability election (ADR 0033), on control and dedicated connections. */
export const createAvailabilityStore = (resources: DatabaseResources) => {
  const { lane, dedicated, waits } = resourcesOf(resources);
  return namedLaneOperations(
    availabilityOperations(lane('control').client, dedicated, waits),
  );
};
export type AvailabilityStore = ReturnType<typeof createAvailabilityStore>;
