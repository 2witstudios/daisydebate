import type { Server } from 'node:http';
import type { AuthConfig } from '@daisy/config';
import type { Logger } from '@daisy/logger';
import { deriveClientIdSubkey } from '../features/auth/client-ip';
import { createHttpServer } from './http-server';

/**
 * The production server start.ts runs, composed from the app this process
 * built, isolated from start.ts's top-level side effects so a test can prove
 * the wiring on a real socket: ingress stamping through the validated
 * `AUTH_TRUSTED_PROXIES`, a client id keyed by `BETTER_AUTH_SECRET`, and the
 * app's own drain flag (AUTH-3.8, ISSUE-158). Reading the auth configuration
 * here, eagerly, is what refuses a production start without auth secrets
 * before Next prepares or the port opens; its errors name fields only
 * (AUTH-7.0-AC3).
 */
export function createProductionServer({
  app,
  handle,
}: {
  readonly app: {
    readonly auth: () => {
      readonly config: Pick<
        AuthConfig,
        'AUTH_TRUSTED_PROXIES' | 'BETTER_AUTH_SECRET'
      >;
    };
    readonly isDraining: () => boolean;
    readonly logger: Logger;
  };
  readonly handle: Parameters<typeof createHttpServer>[0]['handle'];
}): Server {
  const authConfig = app.auth().config;
  return createHttpServer({
    trustedProxies: authConfig.AUTH_TRUSTED_PROXIES,
    clientIdSubkey: deriveClientIdSubkey(authConfig.BETTER_AUTH_SECRET),
    isDraining: app.isDraining,
    logger: app.logger,
    handle,
  });
}
