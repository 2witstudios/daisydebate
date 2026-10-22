import { assert } from 'riteway/bun';
import type { withAttendanceRound } from './attendance.test-support';
import type { PublicCheckInProbeConfiguration } from '../src/features/availability/public-probe';
import { startRoundAvailability } from '../src/server/round-availability';

type Fixture = Parameters<Parameters<typeof withAttendanceRound>[0]>[0];

/** Real PG/HTTP ports; only completion of an actual control read is held. */
export async function verifyAvailabilityLeaseCadence(input: {
  readonly app: Parameters<typeof startRoundAvailability>[0]['app'];
  readonly sql: Fixture['f']['sql'];
  readonly configuration: PublicCheckInProbeConfiguration;
}) {
  const { app, sql } = input;
  const held = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const renewed = Promise.withResolvers<void>();
  let tick = () => {};
  let renewals = 0;
  let probes = 0;
  let failures = 0;
  const [prefix] =
    await sql`select coalesce(max(at),'-infinity'::timestamptz)::text as at from availability_samples`;
  const service = startRoundAvailability({
    app: {
      ...app,
      config: {
        ...app.config,
        ATTENDANCE_PUBLIC_PROBE: JSON.stringify(input.configuration),
      },
      logger: {
        ...app.logger,
        log: () => {
          failures += 1;
        },
      },
      database: {
        ...app.database,
        renewServiceInstance: async (lease) => {
          await app.database.renewServiceInstance(lease);
          if (++renewals === 2) renewed.resolve();
        },
        readRoundBotControlHealth: async () => {
          const actual = await app.database.readRoundBotControlHealth();
          held.resolve();
          await release.promise;
          return actual;
        },
      },
    },
    fetch: async (url, init) => {
      probes += 1;
      return fetch(url, init);
    },
    timers: {
      setInterval: (callback) => {
        tick = callback;
        return 1;
      },
      clearInterval: () => {},
    },
  });
  try {
    await held.promise;
    const [before] =
      await sql`select renewed_at::text as at from service_instances where instance_id=${service.instanceId}`;
    // Advance real PG time across the next cadence, rather than inventing lease time.
    await sql`select pg_sleep(1.05)`;
    tick();
    await renewed.promise;
    const [after] =
      await sql`select renewed_at>${before.at}::timestamptz as renewed from service_instances where instance_id=${service.instanceId}`;
    assert({
      given:
        'actual elected sampler held after its real control read completes',
      should:
        'renew its same PG lease on the next cadence without another public probe',
      actual: [after.renewed, renewals, probes, failures],
      expected: [true, 2, 1, 0],
    });
  } finally {
    release.resolve();
    await service.stop();
    tick();
    await sql`delete from service_instances where instance_id=${service.instanceId}`;
    await sql`delete from availability_samples where at>${prefix.at}::timestamptz`;
  }
}
