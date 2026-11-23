import type { App } from './app';
import { processRetentionTargets, type ProcessWork } from './process-work';

/**
 * The production retention targets on a test's own stores: every feature's
 * entry in the one feature list, given only the database and Redis ports
 * the targets read.
 */
export const retentionTargets = ({
  database,
  redis,
}: {
  readonly database: Partial<App['database']>;
  readonly redis: Partial<App['redis']>;
}) =>
  processRetentionTargets({
    app: { database, redis } as unknown as App,
  } as ProcessWork);
