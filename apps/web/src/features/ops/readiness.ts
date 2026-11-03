import type { Logger } from '@daisy/logger';
import type { ErrorReporter } from '@daisy/observability';
import { withTimeout } from '@daisy/observability';
import { handleOperation } from '../../server/http';

type Probe = { readonly health: () => Promise<boolean> };

/**
 * `/api/health/ready`: ready only once start-up checks have settled, while not
 * draining, and while PostgreSQL and Redis each answer within two seconds.
 */
export function createReadinessHandler({
  database,
  redis,
  isDraining,
  startupChecked = () => true,
  logger,
  reporter,
}: {
  readonly database: Probe;
  readonly redis: Probe;
  readonly isDraining: () => boolean;
  /** False until start-up checks that must precede traffic have settled. */
  readonly startupChecked?: () => boolean;
  readonly logger: Logger;
  /** ADR 0037: where a 5xx from this handler's raw error goes, scrubbed. */
  readonly reporter: ErrorReporter;
}) {
  return (request: Request) =>
    handleOperation(
      logger,
      request,
      'health.readiness',
      async () => {
        const results = await Promise.allSettled([
          withTimeout(database.health(), 2000),
          withTimeout(redis.health(), 2000),
        ]);
        const ready =
          !isDraining() &&
          startupChecked() &&
          results.every(
            (result) => result.status === 'fulfilled' && result.value,
          );
        return Response.json(
          { status: ready ? 'ready' : 'unavailable' },
          { status: ready ? 200 : 503 },
        );
      },
      reporter,
    );
}
