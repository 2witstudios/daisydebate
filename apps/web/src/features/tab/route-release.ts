import type { App } from '../../server/app';
import { createRequestFlagReader } from '../flags/reader';

/**
 * Whether Daisy Tab is released to an account, for a Tab route: a fresh
 * reader for each request, never kept across requests. Only Next route
 * modules import it, so the flag stays out of the proxy's route table.
 */
export const tabReleasedFor =
  (app: App) =>
  (userId: string): Promise<boolean> =>
    createRequestFlagReader({
      read: app.database.readFlagSnapshot,
      now: () => Date.parse(app.clock.now()),
      diagnostic: () =>
        app.logger.log(
          'flags.read.failed',
          { operation: 'flags.read', cause: 'unavailable' },
          'Release control read failed',
        ),
    })('daisy-tab', userId);
