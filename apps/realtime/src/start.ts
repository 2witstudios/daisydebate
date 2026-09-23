import {
  drainWithDeadline,
  installShutdownSignals,
} from '@daisy/observability';
import { createRealtimeServer } from './server';
import { getResources, closeResources } from './resources';
import { parsePort } from './port';

// Unlike apps/web (whose "dev" task runs `next dev`, a different process
// that never touches this file), this is the only entrypoint apps/realtime
// has: "dev" and "start" both run it, differing only in NODE_ENV, which
// `readRealtimeConfig` uses to decide how strictly to validate. There is no
// production-only guard here for that reason.
const resources = getResources();
const port = parsePort(process.env.REALTIME_PORT, 3001);
const { fetch, websocket } = createRealtimeServer({ resources });
const server = Bun.serve({ hostname: '0.0.0.0', port, fetch, websocket });
resources.logger.log(
  'server.start',
  { operation: 'server.start', port },
  'Server listening',
);

/**
 * Stops accepting new HTTP and WebSocket connections and closes the
 * database and Redis pools. It does not close already-open sockets with
 * `4006 server_restarting`: that requires the connection registry
 * RT-2.3b/RT-2.5a build, not this scaffold.
 */
async function shutdown() {
  if (resources.draining) return;
  resources.draining = true;
  resources.logger.log(
    'server.shutdown',
    { operation: 'server.shutdown' },
    'Draining requests',
  );
  await drainWithDeadline({
    deadlineMs: 25_000,
    onDeadlineExceeded: () => process.exit(1),
    close: async () => {
      await server.stop();
      await closeResources();
    },
  });
}
installShutdownSignals(shutdown);
