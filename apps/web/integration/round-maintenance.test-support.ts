import type { Database } from '@daisy/db';
import { startAvailabilityService } from '../src/features/availability/service';

export const maintenanceTestTimers = {
  setInterval: (pulse: () => void, ms: number) => {
    const handle = setInterval(pulse, ms);
    return () => clearInterval(handle);
  },
  clearInterval: (stop: unknown) => {
    if (typeof stop !== 'function') throw new Error('Unknown test timer');
    stop();
  },
};

/** Observes real elected sampling without replacing its SQL or evidence. */
export function maintenanceAvailability(input: {
  readonly store: Database;
  readonly instanceId: string;
  readonly stamps: string[];
  readonly failed: () => void;
}) {
  let sampled!: () => void;
  const firstSample = new Promise<void>((resolve) => {
    sampled = resolve;
  });
  const sampler = input.store.availabilitySampler();
  const service = startAvailabilityService({
    instanceId: input.instanceId,
    store: {
      ...input.store,
      availabilitySampler: () => ({
        ...sampler,
        sample: async (evidence) => {
          const row = await sampler.sample(evidence);
          if (row) input.stamps.push(row.at);
          sampled();
          return row;
        },
      }),
    },
    probe: async () => false,
    timers: maintenanceTestTimers,
    failed: input.failed,
  });
  return { service, firstSample };
}
