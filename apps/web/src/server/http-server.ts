import { createServer, type Server } from 'node:http';
import { readAuthConfig } from '@daisy/config';
import type { Logger } from '@daisy/logger';
import { createIngressListener } from './ingress';

/**
 * The production HTTP server start.ts runs: validated auth configuration,
 * ingress identity stamping through the configured trusted proxies, the
 * shared drain flag, and socket timeouts. Returned unbound; the caller listens.
 */
export function createHttpServer({
  env,
  resources,
  handle,
}: {
  readonly env: Record<string, string | undefined>;
  readonly resources: { readonly draining: boolean; readonly logger: Logger };
  readonly handle: Parameters<typeof createIngressListener>[0]['handle'];
}): Server {
  // Production must not boot without validated auth configuration (secret,
  // Resend sender/key, webhook secret, HTTPS origin); errors name fields only.
  const authConfig = readAuthConfig(env);
  const listen = createIngressListener({
    isDraining: () => resources.draining,
    trustedProxies: authConfig.AUTH_TRUSTED_PROXIES ?? [],
    handle,
    onError: () =>
      resources.logger.log(
        'http.request.failed',
        { operation: 'http.request', errorCode: 'INTERNAL' },
        'Request failed',
      ),
  });
  const server = createServer((request, response) => {
    void listen(request, response);
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  return server;
}
