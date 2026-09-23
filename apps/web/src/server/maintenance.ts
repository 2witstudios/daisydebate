import {
  createVerificationCleanup,
  startVerificationCleanup,
} from '../features/auth/verification-cleanup';
import {
  createOutboxCleanup,
  startOutboxCleanup,
} from '../features/realtime/outbox-cleanup';

/**
 * Background retention for the production server: composes the hourly
 * verification cleanup (AUTH-7.5a) and outbox sweep (RT-2.2) over the
 * existing database pool. Timers are injected so the composition is
 * testable; production passes the globals.
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
    readonly purgeExpiredOutboxEvents: Parameters<
      typeof createOutboxCleanup
    >[0]['purge'];
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
  const verification = startVerificationCleanup({
    cleanup,
    timers,
    runOnStart: true,
  });
  const outboxCleanup = createOutboxCleanup({
    purge: (input) => database.purgeExpiredOutboxEvents(input),
    clock,
    logger,
  });
  const outbox = startOutboxCleanup({
    cleanup: outboxCleanup,
    timers,
    runOnStart: true,
  });
  return {
    initial: Promise.all([verification.initial, outbox.initial]),
    stop: async () => {
      await Promise.all([verification.stop(), outbox.stop()]);
    },
  };
}
