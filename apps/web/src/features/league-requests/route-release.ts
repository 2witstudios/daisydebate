import type { App } from '../../server/app';
import { createRequestFlagReader } from '../flags/reader';
import { releaseFlagDefault } from '../flags/release-default';

/**
 * Whether League requests are open, for their route: a fresh reader for
 * each request, read for no account (the form is the same signed in or
 * out). Only Next route modules and the form's action import it, so the
 * flag stays out of the proxy's route table.
 */
export const leagueRequestsReleased = (app: App) => (): Promise<boolean> =>
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
  })('league-requests', null);
