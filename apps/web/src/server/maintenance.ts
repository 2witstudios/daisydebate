import {
  createVerificationCleanup,
  startVerificationCleanup,
} from '../features/auth/verification-cleanup';

/**
 * Background retention for the production server (AUTH-7.5a): composes the
 * hourly verification cleanup over the existing database pool. Timers are
 * injected so the composition is testable; production passes the globals.
 */
type CleanupOptions = Parameters<typeof createVerificationCleanup>[0];

export function startMaintenance({
  database,
  clock,
  logger,
  timers,
}: {
  readonly database: {
    readonly purgeExpiredVerifications: CleanupOptions['purge'];
  };
  readonly clock: CleanupOptions['clock'];
  readonly logger: CleanupOptions['logger'];
  readonly timers: Parameters<typeof startVerificationCleanup>[0]['timers'];
}) {
  const cleanup = createVerificationCleanup({
    purge: (input) => database.purgeExpiredVerifications(input),
    clock,
    logger,
  });
  return startVerificationCleanup({ cleanup, timers, runOnStart: true });
}
