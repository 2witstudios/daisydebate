import type { Server } from 'bun';
import type { Logger } from '@daisy/logger';
import { resolveClientIp } from '@daisy/ingress/client-ip';
import { createAdmission } from './admission';
import { checkReadiness, type ReadinessResources } from './health';
import {
  createWebSocketHandlers,
  type SocketData,
  type SocketTimers,
} from './socket';

/**
 * Bun socket tuning, server-side and Bun-specific, so it lives here rather
 * than in the portable protocol. `idleTimeout` is in seconds, not
 * milliseconds: it reaps a silent peer (ADR 0031 §7). The backpressure
 * limit is the hard backstop in bytes (ADR 0031 §9).
 */
const IDLE_TIMEOUT_SECONDS = 36;
const BACKPRESSURE_LIMIT_BYTES = 1_048_576;

/** ADR 0031 §3: sockets connect on exactly this path; everywhere else is HTTP. */
export const SOCKET_PATH = '/ws';

export type RealtimeServerResources = ReadinessResources & {
  readonly logger: Logger;
};

const noStore = { 'Cache-Control': 'no-store' } as const;
const liveResponse = () =>
  Response.json({ status: 'alive' }, { headers: noStore });
/**
 * Never exposes which dependency is down: an internet-facing readiness
 * route that named `redis: false` would hand an attacker a live outage map
 * (AGENTS.md: "public errors must not expose internals"), unlike apps/web's
 * `/api/health/ready`, which already returns `{status}` only. Which check
 * failed is still traceable: `@daisy/db`'s `health`/`checkListen` and
 * `@daisy/redis`'s `health` each log their own `db.query.failed` or
 * `redis.command.failed` event (with `operation` naming the check) through
 * the same `eventSink` wired into `resources.logger` at composition.
 */
const readyResponse = async (resources: RealtimeServerResources) => {
  const report = await checkReadiness(resources);
  if (report.deliverySeqLagEstimate !== undefined)
    resources.logger.log(
      'realtime.outbox.delivery_lag_estimated',
      { deliverySeqLagEstimate: report.deliverySeqLagEstimate },
      'Delivery lag estimated',
    );
  return Response.json(
    { status: report.ready ? 'ready' : 'unavailable' },
    { status: report.ready ? 200 : 503, headers: noStore },
  );
};

/**
 * Bun.serve wiring (ADR 0031 §2): health routes, the single WebSocket path
 * (every other request to it is 400, section 3), and the socket lifecycle.
 * No domain routing exists yet: everything else is 404.
 */
export function createRealtimeServer({
  resources,
  timers,
  allowedOrigins = [],
  trustedProxies = [],
  socketDependencies,
  admission = createAdmission({
    now: () => performance.now(),
    maxPerIp: 20,
    maxUnauthenticated: 4,
    maxPerActor: 8,
  }),
}: {
  readonly resources: RealtimeServerResources;
  readonly timers?: SocketTimers;
  readonly allowedOrigins?: readonly string[];
  readonly trustedProxies?: readonly string[];
  readonly admission?: ReturnType<typeof createAdmission>;
  readonly socketDependencies?: Omit<
    Parameters<typeof createWebSocketHandlers>[0],
    'logger' | 'timers'
  >;
}) {
  const websocket = createWebSocketHandlers({
    logger: resources.logger,
    ...socketDependencies,
    ...(timers ? { timers } : {}),
  });
  function isUpgrade(request: Request) {
    return (
      new URL(request.url).search === '' &&
      request.method === 'GET' &&
      request.headers.get('upgrade')?.toLowerCase() === 'websocket'
    );
  }
  function upgrade(request: Request, server: Server<SocketData>) {
    if (resources.isDraining()) return new Response(null, { status: 503 });
    if (!isUpgrade(request)) return new Response(null, { status: 400 });
    const origin = request.headers.get('origin');
    if (!origin || !allowedOrigins.includes(origin))
      return new Response(null, { status: 403 });
    const peer = server.requestIP(request)?.address;
    const ip = resolveClientIp({
      peer,
      forwardedFor: request.headers.get('x-forwarded-for'),
      flyClientIp: request.headers.get('fly-client-ip'),
      trustedProxies,
    });
    const reservation = admission.reserve(ip ?? 'unknown');
    if (!reservation) return new Response(null, { status: 429 });
    const data: SocketData = { origin, admission: reservation };
    if (server.upgrade(request, { data })) return undefined;
    reservation.release();
    return new Response(null, { status: 400 });
  }
  return {
    async fetch(
      request: Request,
      server: Server<SocketData>,
    ): Promise<Response | undefined> {
      const { pathname } = new URL(request.url);
      if (pathname === '/health/live') return liveResponse();
      if (pathname === '/health/ready') return readyResponse(resources);
      if (pathname === SOCKET_PATH) {
        return upgrade(request, server);
      }
      return new Response(null, { status: 404 });
    },
    websocket: {
      ...websocket,
      // ADR 0031 §6, §9, §10: 4 KiB inbound frames, the measured idle
      // reaping window, the hard backpressure backstop, and compression off.
      maxPayloadLength: 4096,
      idleTimeout: IDLE_TIMEOUT_SECONDS,
      backpressureLimit: BACKPRESSURE_LIMIT_BYTES,
      closeOnBackpressureLimit: true,
      perMessageDeflate: false,
      sendPings: true,
    },
  };
}
