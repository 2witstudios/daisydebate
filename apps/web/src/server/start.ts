import next from 'next';
import { z } from 'zod';
import { createHttpServer } from './http-server';
import { startMaintenance } from './maintenance';
import { getResources, closeResources } from './resources';

// Next 16 types NODE_ENV as read-only; the process supervisor sets it before launch.
if (process.env.NODE_ENV !== 'production')
  throw new Error(
    `Production start requires NODE_ENV=production (received ${
      process.env.NODE_ENV ?? 'unset'
    })`,
  );
const resources = getResources();
const port = z.coerce
  .number()
  .int()
  .min(1)
  .max(65535)
  .parse(process.env.PORT ?? 3000);
const app = next({ dev: false, port });
// Validates auth configuration before Next prepares; the handler it wraps
// only resolves Next's request handler per request, after prepare().
const server = createHttpServer({
  env: process.env,
  resources,
  handle: app.getRequestHandler(),
});
await app.prepare();
server.listen(port, '0.0.0.0', () =>
  resources.logger.log(
    'server.start',
    { operation: 'server.start', port },
    'Server listening',
  ),
);
// Bounded retention runs at start and then hourly in this process; `unref` never holds it open.
const maintenance = startMaintenance({
  database: resources.database,
  clock: resources.clock,
  logger: resources.logger,
  timers: {
    setInterval: (tick, ms) => setInterval(tick, ms).unref(),
    clearInterval: (handle) => clearInterval(handle as NodeJS.Timeout),
  },
});
async function shutdown() {
  if (resources.draining) return;
  resources.draining = true;
  // Ends any cleanup between batches; awaited before the pool closes below.
  const maintenanceStopped = maintenance.stop();
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
  await maintenanceStopped;
  await closeResources();
  clearTimeout(deadline);
}
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.once(signal, () => void shutdown().catch(() => process.exit(1)));
