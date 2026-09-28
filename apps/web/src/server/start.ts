import { readFileSync } from 'node:fs';
import next from 'next';
import { refuseSchemaAlteringRole } from '@daisy/db';
import {
  drainWithDeadline,
  installShutdownSignals,
} from '@daisy/observability';
import { deriveClientIdSubkey } from '../features/auth/client-ip';
import { createHttpServer } from './http-server';
import {
  closeProcessApp,
  processApp,
  processStartOptions,
} from './process-app';
import {
  createRetentionSweep,
  retentionTargets,
  startRetentionSweep,
} from './retention-sweep';
import { defaultGateway, resolveTrustedProxies } from './trusted-proxies';
import { waitForHealthy } from './wait-for-healthy';

// Refuses anything but NODE_ENV=production before building the app.
const { port } = processStartOptions();
const app = processApp();
// Production must not boot without validated auth configuration (secret,
// Resend sender/key, webhook secret, HTTPS origin); errors name fields only.
const authConfig = app.auth().config;
// Production refuses a DATABASE_URL role that could create or alter schema
// objects, before Next prepares or the port opens (ISSUE-39).
await refuseSchemaAlteringRole(app, 'daisy_web');
// The one read of the route table: the `gateway` keyword in
// AUTH_TRUSTED_PROXIES trusts only this machine's default gateway (fly-proxy's
// address on Fly, ISSUE-162). Unreadable or ambiguous, it trusts nothing for
// that entry — every caller then shares the gateway's identity — and says so.
const readGateway = () => {
  try {
    return defaultGateway(readFileSync('/proc/net/route', 'utf8'));
  } catch {
    return null;
  }
};
const { trustedProxies, gatewayUnresolved } = resolveTrustedProxies(
  authConfig.AUTH_TRUSTED_PROXIES,
  authConfig.AUTH_TRUSTED_PROXIES.length > 0 ? readGateway() : null,
);
if (gatewayUnresolved)
  app.logger.log(
    'ingress.trusted_proxy.unresolved',
    { operation: 'server.start' },
    'No single default gateway was found, so no proxy is trusted for it',
  );
const nextApp = next({ dev: false, port });
// The handler it wraps only resolves Next's request handler per request,
// after prepare().
const server = createHttpServer({
  trustedProxies,
  clientIdSubkey: deriveClientIdSubkey(authConfig.BETTER_AUTH_SECRET),
  isDraining: app.isDraining,
  logger: app.logger,
  handle: nextApp.getRequestHandler(),
});
await nextApp.prepare();
server.listen(port, '0.0.0.0', () =>
  app.logger.log(
    'server.start',
    { operation: 'server.start', port },
    'Server listening',
  ),
);
// The one bounded retention sweep runs at start and then hourly in this
// process; `unref` never holds it open. The start-up run waits for Redis to
// answer first (ISSUE-146): a scale-to-zero Fly machine's Redis connection
// is not necessarily ready the instant this process starts listening, and
// readiness already reports 503 correctly during that window (a live check
// per request, never a boot flag) — this only stops the sweep from logging
// a spurious retention.sweep.failed on every cold boot.
const retention = startRetentionSweep({
  sweep: createRetentionSweep({
    targets: retentionTargets({ database: app.database, redis: app.redis }),
    clock: app.clock,
    logger: app.logger,
  }),
  runOnStart: true,
  waitUntilReady: () =>
    waitForHealthy({
      health: () => app.redis.health(),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      timeout: (ms) =>
        new Promise((resolve) => setTimeout(resolve, ms).unref()),
    }),
  timers: {
    setInterval: (tick, ms) => setInterval(tick, ms).unref(),
    clearInterval: (handle) => clearInterval(handle as NodeJS.Timeout),
  },
});
async function shutdown() {
  if (app.isDraining()) return;
  app.drain();
  // Ends any sweep between batches; awaited before the pools close below.
  const retentionStopped = retention.stop();
  app.logger.log(
    'server.shutdown',
    { operation: 'server.shutdown' },
    'Draining requests',
  );
  await drainWithDeadline({
    deadlineMs: 25_000,
    onDeadlineExceeded: () => {
      server.closeAllConnections();
      process.exit(1);
    },
    close: async () => {
      // Keep-alive sockets would otherwise hold close() until their idle timeout.
      server.closeIdleConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await nextApp.close();
      await retentionStopped;
      await closeProcessApp();
    },
  });
}
installShutdownSignals(shutdown);
