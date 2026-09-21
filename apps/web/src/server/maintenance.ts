import type { Clock } from '@daisy/clock';
import type { Logger } from '@daisy/logger';
import {
  createVerificationCleanup,
  startVerificationCleanup,
} from '../features/auth/verification-cleanup';

/**
 * Background retention for the production server (AUTH-7.5a): composes the
 * hourly verification cleanup over the existing database pool. Timers are
 * injected so the composition is testable; production passes the globals.
 */
export function startMaintenance({
  database,
  clock,
  logger,
  timers,
}: {
  readonly database: {
    readonly purgeExpiredVerifications: (input: {
      before: string;
      limit: number;
    }) => Promise<number>;
  };
  readonly clock: Clock;
  readonly logger: Logger;
  readonly timers: Parameters<typeof startVerificationCleanup>[0]['timers'];
}) {
  return startVerificationCleanup({
    cleanup: createVerificationCleanup({
      purge: (input) => database.purgeExpiredVerifications(input),
      clock,
      logger,
    }),
    timers,
    runOnStart: true,
  });
}
