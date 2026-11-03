import type { Database } from '@daisy/db';
import { spectatorClockAt } from '../spectating/spectator-clock';

const BATCH = 64;

/**
 * One pass: tell everyone a released event is due to reach. A repeat, or a second
 * instance, tells no one twice. Retention is the retention sweep's.
 */
export const createNotificationSweep =
  (deps: {
    readonly store: Pick<Database, 'sweepNotificationFanouts'>;
    readonly now: () => string;
    readonly nextId: () => string;
  }) =>
  () =>
    deps.store.sweepNotificationFanouts({
      clock: spectatorClockAt(deps.now()),
      limit: BATCH,
      nextId: deps.nextId,
    });
