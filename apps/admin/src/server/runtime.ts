import { systemClock, systemId } from '@daisy/clock';
import { createLogger, type Logger } from '@daisy/logger';
import type { AuthDeps } from '../auth/attempts';
import { systemRandom } from '../auth/secrets';
import { canonicalCeremony } from '../auth/webauthn';
import { readAdminConfig, type AdminConfig } from '../config';
import { openAdminDatabase, type AdminDatabaseHandle } from '../db/client';

/**
 * The process's one set of resources, built on first use from the validated
 * environment: the database pool, the logger and the ceremony dependencies
 * every server action and page reads through.
 */
export type AdminRuntime = {
  readonly config: AdminConfig;
  readonly database: AdminDatabaseHandle;
  readonly logger: Logger;
  readonly auth: AuthDeps;
};

let runtime: AdminRuntime | undefined;

export function adminRuntime(): AdminRuntime {
  if (runtime) return runtime;
  const config = readAdminConfig(process.env);
  const database = openAdminDatabase(config.ADMIN_DATABASE_URL);
  runtime = {
    config,
    database,
    logger: createLogger({
      service: 'admin',
      appVersion: config.APP_VERSION,
      gitCommit: config.GIT_COMMIT,
    }),
    auth: {
      db: database.db,
      clock: systemClock,
      ids: systemId,
      random: systemRandom,
      attemptKey: config.ADMIN_ATTEMPT_KEY,
      ceremony: canonicalCeremony,
    },
  };
  return runtime;
}
