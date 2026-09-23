import type { Server } from 'bun';
import { backpressureBounds, idleTimeout } from '@daisy/protocol';
import type { Logger } from '@daisy/logger';
import { checkReadiness, type ReadinessResources } from './health';
import {
  createWebSocketHandlers,
  type SocketData,
  type SocketTimers,
} from './socket';

/** ADR 0031 §3: sockets connect on exactly this path; everywhere else is HTTP. */
export const SOCKET_PATH = '/ws';

export type RealtimeServerResources = ReadinessResources & {
  readonly logger: Logger;
};

const noStore = { 'Cache-Control': 'no-store' } as const;
const liveResponse = () =>
  Response.json({ status: 'alive' }, { headers: noStore });
const readyResponse = async (resources: ReadinessResources) => {
  const report = await checkReadiness(resources);
  return Response.json(
    { status: report.ready ? 'ready' : 'unavailable', checks: report.checks },
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
}: {
  readonly resources: RealtimeServerResources;
  readonly timers?: SocketTimers;
}) {
  const websocket = createWebSocketHandlers(
    timers
      ? { logger: resources.logger, timers }
      : { logger: resources.logger },
  );
  return {
    async fetch(
      request: Request,
      server: Server<SocketData>,
    ): Promise<Response | undefined> {
      const { pathname } = new URL(request.url);
      if (pathname === '/health/live') return liveResponse();
      if (pathname === '/health/ready') return readyResponse(resources);
      if (pathname === SOCKET_PATH) {
        const data: SocketData = {};
        if (server.upgrade(request, { data })) return undefined;
        return new Response(null, { status: 400 });
      }
      return new Response(null, { status: 404 });
    },
    websocket: {
      ...websocket,
      // ADR 0031 §6, §9, §10: 4 KiB inbound frames, the measured idle
      // reaping window, the hard backpressure backstop, and compression off.
      maxPayloadLength: 4096,
      idleTimeout,
      backpressureLimit: backpressureBounds.hardBytes,
      closeOnBackpressureLimit: true,
      perMessageDeflate: false,
      sendPings: true,
    },
  };
}
