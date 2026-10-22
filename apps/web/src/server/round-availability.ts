import type { App } from './app';
import { readPublicCheckInProbe } from '../features/availability/configuration';
import { createPublicCheckInProbe } from '../features/availability/public-probe';
import { startAvailabilityService } from '../features/availability/service';

/** Start only after public ingress is accepting requests; stop before closing its owned pool. */
export function startRoundAvailability(input: {
  readonly app: App;
  readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
  readonly timers: Parameters<typeof startAvailabilityService>[0]['timers'];
}) {
  const { app } = input;
  return startAvailabilityService({
    instanceId: app.ids.next(),
    store: app.database,
    timers: input.timers,
    probe: createPublicCheckInProbe({
      configuration: readPublicCheckInProbe(app.config.ATTENDANCE_PUBLIC_PROBE),
      nextId: () => app.ids.next(),
      fetch: input.fetch,
    }),
    failed: () =>
      app.logger.log(
        'availability.sample_failed',
        { operation: 'availability.sample', errorCode: 'INFRASTRUCTURE' },
        'Availability evidence unavailable',
      ),
  });
}
