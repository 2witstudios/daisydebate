import { createServer } from 'node:http';
import next from 'next';
import { z } from 'zod';
import { readAuthConfig } from '@daisy/config';
import { createIngressListener } from './ingress';
import { getResources, closeResources } from './resources';

// Next 16 types NODE_ENV as read-only; the process supervisor sets it before launch.
if (process.env.NODE_ENV !== 'production')
  throw new Error(
    `Production start requires NODE_ENV=production (received ${
      process.env.NODE_ENV ?? 'unset'
    })`,
  );
const resources = getResources();
// Production must not boot without validated auth configuration (secret,
// Resend sender/key, webhook secret, HTTPS origin); errors name fields only.
const authConfig = readAuthConfig(process.env);
const trustedProxies = authConfig.AUTH_TRUSTED_PROXIES ?? [];
const port = z.coerce
  .number()
  .int()
  .min(1)
  .max(65535)
  .parse(process.env.PORT ?? 3000);
const app = next({ dev: false, port });
await app.prepare();
const handle = app.getRequestHandler();
const listen = createIngressListener({
  isDraining: () => resources.draining,
  trustedProxies,
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
server.listen(port, '0.0.0.0', () =>
  resources.logger.log(
    'server.start',
    { operation: 'server.start', port },
    'Server listening',
  ),
);
async function shutdown() {
  if (resources.draining) return;
  resources.draining = true;
  resources.logger.log(
    'server.shutdown',
    { operation: 'server.shutdown' },
    'Draining requests',
  );
  const deadline = setTimeout(() => {
    server.closeAllConnections();
    process.exit(1);
  }, 25_000);
  deadline.unref();
  // Keep-alive sockets would otherwise hold close() until their idle timeout.
  server.closeIdleConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  await app.close();
  await closeResources();
  clearTimeout(deadline);
}
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.once(signal, () => void shutdown().catch(() => process.exit(1)));
