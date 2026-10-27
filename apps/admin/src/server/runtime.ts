import { systemClock, systemId } from '@daisy/clock';
import { createLogger, type Logger } from '@daisy/logger';
import type { AuthDeps } from '../auth/attempts';
import { systemRandom } from '../auth/secrets';
import { canonicalCeremony } from '../auth/webauthn';
import {
  readAdminConfig,
  readOperatorClientConfig,
  type AdminConfig,
} from '../config';
import { openAdminDatabase, type AdminDatabaseHandle } from '../db/client';
import type { CommandDeps } from '../features/accounts/commands';
import { createOperatorClient } from '../features/operator-client/client';
import { bunOperatorCrypto } from '../features/operator-client/bun-crypto';

/** How long a signed request may take before its outcome counts as unknown. */
const OPERATOR_TIMEOUT_MS = 5_000;

/**
 * The process's one set of resources, built on first use from the validated
 * environment: the database pool, the logger, the ceremony dependencies
 * every server action and page reads through, and the operator commands
 * (null while the operator API is unconfigured).
 */
export type AdminRuntime = {
  readonly config: AdminConfig;
  readonly database: AdminDatabaseHandle;
  readonly logger: Logger;
  readonly auth: AuthDeps;
  readonly commands: CommandDeps | null;
};

let runtime: AdminRuntime | undefined;

export function adminRuntime(): AdminRuntime {
  if (runtime) return runtime;
  const config = readAdminConfig(process.env);
  const database = openAdminDatabase(config.ADMIN_DATABASE_URL);
  const operatorApi = readOperatorClientConfig(process.env);
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
    commands: operatorApi && {
      db: database.db,
      clock: systemClock,
      ids: systemId,
      client: createOperatorClient({
        config: operatorApi,
        crypto: bunOperatorCrypto,
        clock: systemClock,
        random: systemRandom,
        fetch: (url, init) => fetch(url, init),
        timeoutMs: OPERATOR_TIMEOUT_MS,
      }),
    },
  };
  return runtime;
}
