import { tryInstantMs } from '@daisy/clock';
import { cache } from 'react';
import { createRequestFlagReader } from './reader';
import { releaseFlagDefault } from './release-default';
import { type ReleaseFlagKey } from './catalogue';
import { requestApp } from '../../lib/page-reads';

const requestFlagReader = cache(() => {
  const app = requestApp();
  return createRequestFlagReader({
    read: (accountId, keys) => app.database.readFlagSnapshot(accountId, keys),
    now: () => tryInstantMs(app.clock.now()) ?? Number.NaN,
    diagnostic: () =>
      app.logger.log(
        'flags.read.failed',
        { operation: 'flags.read', cause: 'unavailable' },
        'Release control read failed',
      ),
    releaseDefault: releaseFlagDefault(app.config),
  });
});

/** One subject snapshot per render request; anonymous resolution has no targeting. */
export const requestReleaseEnabled = (
  key: ReleaseFlagKey,
  accountId: string | null,
) => requestFlagReader()(key, accountId);
