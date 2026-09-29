import { readFileSync } from 'node:fs';
import next from 'next';
import { refuseSchemaAlteringRole } from '@daisy/db';
import {
  drainWithDeadline,
  installShutdownSignals,
} from '@daisy/observability';
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
import { createStartupGate, listenThenPrepare } from './listen-first';
import { createProductionServer } from './server-wiring';
import { waitForHealthy } from './wait-for-healthy';

// Refuses anything but NODE_ENV=production before building the app.
const { port } = processStartOptions();
const app = processApp();
const nextApp = next({ dev: false, port });
// Every request waits behind this gate until the start-up work below
// finishes (ISSUE-172): readiness answers 503 and nothing reaches Next.
const gate = createStartupGate(nextApp.getRequestHandler());
// Production must not boot without validated auth configuration (secret,
// Resend sender/key, webhook secret, HTTPS origin): building the server
// reads it eagerly and its errors name fields only. The handler it wraps
// only resolves Next's request handler per request, after prepare().
const server = createProductionServer({
  app,
  handle: gate.handle,
  // The one read of the route table, for the `gateway` keyword in
  // AUTH_TRUSTED_PROXIES (ISSUE-162); unreadable, it trusts nothing for it.
  readRouteTable: () => {
    try {
      return readFileSync('/proc/net/route', 'utf8');
    } catch {
      return null;
    }
  },
});
// The port opens first, so a cold machine answers its health checks while
// the slow work runs (ISSUE-172). Production refuses a DATABASE_URL role
// that could create or alter schema objects before Next prepares, and no
// request reaches Next until both finish (ISSUE-39); a refusal exits here.
await listenThenPrepare({
  server,
  port,
  host: '0.0.0.0',
  prepare: async () => {
    await refuseSchemaAlteringRole(app, 'daisy_web');
    await nextApp.prepare();
  },
  gate,
  logger: app.logger,
  clock: app.clock,
});
// The one bounded retention sweep runs at start and then hourly in this
// process; `unref` never holds it open. The start-up run waits for Redis to
// answer first (ISSUE-146): a freshly started Fly machine's Redis connection
// is not necessarily ready the instant this process is ready, and
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
