import { systemClock, systemId } from '@daisy/clock';
import {
  drainWithDeadline,
  installShutdownSignals,
} from '@daisy/observability';
import { createRealtimeApp } from './app';
import { DEFAULT_REALTIME_PORT, parsePort } from './port';
import { serveRealtime } from './serve';
import { readFile } from 'node:fs/promises';
import {
  defaultGateway,
  resolveTrustedProxies,
} from '@daisy/ingress/trusted-proxies';

// Unlike apps/web (whose "dev" task runs `next dev`, a different process
// that never touches this file), this is the only entrypoint apps/realtime
// has: "dev" and "start" both run it, differing only in NODE_ENV, which
// `readRealtimeConfig` uses to decide how strictly to validate. There is no
// production-only guard here for that reason.
//
// This is realtime's process edge: the only module that reads process.env.
// It builds the one app this process runs; everything else receives it.
const resources = createRealtimeApp({
  env: process.env,
  clock: systemClock,
  ids: systemId,
});
const port = parsePort(process.env.REALTIME_PORT, DEFAULT_REALTIME_PORT);

// `serveRealtime` awaits startup order (ADR 0032 §2: LISTEN, then the
// high-water mark) before `Bun.serve` accepts sockets with the real registry.
const routeTable =
  resources.transport.trustedProxyEntries.length > 0
    ? await readFile('/proc/net/route', 'utf8').catch(() => null)
    : null;
const { trustedProxies, gatewayUnresolved } = resolveTrustedProxies(
  resources.transport.trustedProxyEntries,
  routeTable === null ? null : defaultGateway(routeTable),
);
if (gatewayUnresolved)
  resources.logger.log(
    'ingress.trusted_proxy.unresolved',
    { operation: 'server.start' },
    'No single default gateway was found, so no proxy is trusted for it',
  );
const { close } = await serveRealtime({
  resources,
  port,
  trustedProxies,
});
resources.logger.log(
  'server.start',
  { operation: 'server.start', port },
  'Server listening',
);

/**
 * Stops accepting new HTTP and WebSocket connections, then the drain loop's
 * LISTEN subscription and the database and Redis pools. Open sockets receive
 * `4006 server_restarting` before the transport stops.
 */
async function shutdown() {
  if (resources.isDraining()) return;
  resources.drain();
  resources.logger.log(
    'server.shutdown',
    { operation: 'server.shutdown' },
    'Draining requests',
  );
  await drainWithDeadline({
    deadlineMs: 25_000,
    onDeadlineExceeded: () => process.exit(1),
    close: async () => {
      await close();
      await resources.close();
    },
  });
}
installShutdownSignals(shutdown);
