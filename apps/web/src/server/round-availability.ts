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
  const instanceId = app.ids.next();
  const configuration = readPublicCheckInProbe(
    app.config.ATTENDANCE_PUBLIC_PROBE,
    app.config.PUBLIC_APP_URL,
  );
  const lifecycle = startAvailabilityService({
    instanceId,
    store: app.database,
    timers: input.timers,
    nowMs: () => performance.now(),
    probe: createPublicCheckInProbe({
      configuration,
      nextId: () => app.ids.next(),
      nowMs: () => performance.now(),
      fetch: input.fetch,
    }),
    probeResources: () =>
      configuration
        ? app.database.publicProbeResourceProblems(configuration)
        : Promise.resolve([]),
    probeInvalid: (problem) =>
      app.logger.log(
        'availability.probe_invalid',
        { operation: 'availability.probe', cause: problem },
        'Public check-in probe cannot prove health',
      ),
    renewal: (outcome) =>
      outcome.kind === 'renewed'
        ? app.serviceLease.renewed()
        : app.serviceLease.renewalFailed(outcome.error),
    failed: () =>
      app.logger.log(
        'availability.sample_failed',
        { operation: 'availability.sample', errorCode: 'INFRASTRUCTURE' },
        'Availability evidence unavailable',
      ),
  });
  return { ...lifecycle, instanceId } as const;
}
