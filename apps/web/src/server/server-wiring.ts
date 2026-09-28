import type { AuthConfig } from '@daisy/config';
import type { Logger } from '@daisy/logger';
import { deriveClientIdSubkey } from '../features/auth/client-ip';
import type { createHttpServer } from './http-server';

/**
 * The exact options start.ts hands createHttpServer, isolated from the
 * module's top-level side effects so a test can prove the wiring: trusted
 * proxies and the drain flag come from the app this process built, not a
 * literal (AUTH-3.8, ISSUE-158).
 */
export function buildHttpServerOptions({
  app,
  authConfig,
  handle,
}: {
  readonly app: {
    readonly isDraining: () => boolean;
    readonly logger: Logger;
  };
  readonly authConfig: Pick<
    AuthConfig,
    'AUTH_TRUSTED_PROXIES' | 'BETTER_AUTH_SECRET'
  >;
  readonly handle: Parameters<typeof createHttpServer>[0]['handle'];
}): Parameters<typeof createHttpServer>[0] {
  return {
    trustedProxies: authConfig.AUTH_TRUSTED_PROXIES,
    clientIdSubkey: deriveClientIdSubkey(authConfig.BETTER_AUTH_SECRET),
    isDraining: app.isDraining,
    logger: app.logger,
    handle,
  };
}
