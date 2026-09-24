import next from 'next';
import {
  drainWithDeadline,
  installShutdownSignals,
} from '@daisy/observability';
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

// Refuses anything but NODE_ENV=production before building the app.
const { port } = processStartOptions();
const app = processApp();
// Production must not boot without validated auth configuration (secret,
// Resend sender/key, webhook secret, HTTPS origin); errors name fields only.
const authConfig = app.auth().config;
const nextApp = next({ dev: false, port });
// The handler it wraps only resolves Next's request handler per request,
// after prepare().
const server = createHttpServer({
  trustedProxies: authConfig.AUTH_TRUSTED_PROXIES ?? [],
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
// The one bounded retention sweep runs at start and then hourly in this process; `unref` never holds it open.
const retention = startRetentionSweep({
  sweep: createRetentionSweep({
    targets: retentionTargets({ database: app.database, redis: app.redis }),
    clock: app.clock,
    logger: app.logger,
  }),
  runOnStart: true,
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
