import type { App } from '../../server/app';
import type { ReleaseFlagKey } from './catalogue';
import { createRequestFlagReader } from './reader';
import { releaseFlagDefault } from './release-default';

/**
 * Whether a release flag is open, for a route: a fresh reader for each
 * call, never kept across requests. Only Next route modules and server
 * actions import it, so release flags stay out of the proxy's route table
 * (ADR 0118).
 */
export const routeReleaseFor =
  (app: App) =>
  (key: ReleaseFlagKey, accountId: string | null): Promise<boolean> =>
    createRequestFlagReader({
      read: app.database.readFlagSnapshot,
      now: () => Date.parse(app.clock.now()),
      diagnostic: () =>
        app.logger.log(
          'flags.read.failed',
          { operation: 'flags.read', cause: 'unavailable' },
          'Release control read failed',
        ),
      releaseDefault: releaseFlagDefault(app.config),
    })(key, accountId);
