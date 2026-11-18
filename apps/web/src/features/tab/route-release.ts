import type { App } from '../../server/app';
import { createRequestFlagReader } from '../flags/reader';
import { releaseFlagDefault } from '../flags/release-default';

/**
 * Whether Daisy Tab is released to an account, for a Tab route: a fresh
 * reader for each request, never kept across requests. Only Next route
 * modules import it, so the flag stays out of the proxy's route table.
 */
const releaseFor =
  (app: App, key: 'daisy-tab' | 'daisy-tab-minors') =>
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
      releaseDefault: releaseFlagDefault(app.config),
    })(key, userId);

export const tabReleasedFor = (app: App) => releaseFor(app, 'daisy-tab');
export const tabMinorsReleasedFor = (app: App) =>
  releaseFor(app, 'daisy-tab-minors');
