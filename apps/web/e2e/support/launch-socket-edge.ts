import type { ServerWebSocket } from 'bun';

type Bridge = {
  upstream: WebSocket | null;
  url: string;
  origin: string | null;
  closed: boolean;
  queue: (string | Buffer)[];
};
const wire = (message: string | Buffer) =>
  typeof message === 'string' ? message : Uint8Array.from(message);
const closeBridge = (socket: ServerWebSocket<Bridge>) => {
  socket.data.closed = true;
  socket.data.queue = [];
  socket.data.upstream?.close();
  socket.close(1001, 'Connection closed');
};
/** Trusted TLS forwarding to actual suite-owned signalling and realtime services. */
export function createLaunchSocketEdge(input: {
  readonly port: number;
  readonly upstreamPort: number;
  readonly socketPath?: string;
  readonly allowedOrigin?: string;
  readonly tls: { key: Buffer; cert: Buffer };
}) {
  return Bun.serve<Bridge>({
    hostname: '127.0.0.1',
    port: input.port,
    tls: input.tls,
    async fetch(request, server) {
      const url = new URL(request.url),
        target = new URL(
          `http://127.0.0.1:${input.upstreamPort}${url.pathname}${url.search}`,
        );
      if (input.socketPath && url.pathname !== input.socketPath)
        return new Response('Not found', { status: 404 });
      if (
        input.allowedOrigin &&
        request.headers.get('origin') !== input.allowedOrigin
      )
        return new Response('Forbidden', { status: 403 });
      if (request.headers.get('upgrade')?.toLowerCase() === 'websocket') {
        target.protocol = 'ws:';
        if (
          server.upgrade(request, {
            data: {
              upstream: null,
              url: target.href,
              origin: request.headers.get('origin'),
              closed: false,
              queue: [],
            },
          })
        )
          return;
        return new Response('Connection unavailable', { status: 503 });
      }
      try {
        const response = await fetch(target, {
          method: request.method,
          headers: request.headers,
          redirect: 'manual',
          ...(request.method !== 'GET' && request.method !== 'HEAD'
            ? { body: await request.arrayBuffer() }
            : {}),
        });
        const headers = new Headers(response.headers);
        headers.delete('content-encoding');
        headers.delete('content-length');
        return new Response(response.body, {
          status: response.status,
          headers,
        });
      } catch {
        return new Response('Connection unavailable', { status: 503 });
      }
    },
    websocket: {
      open(socket) {
        const upstream = new WebSocket(socket.data.url, {
          headers: socket.data.origin ? { origin: socket.data.origin } : {},
        });
        upstream.binaryType = 'arraybuffer';
        socket.data.upstream = upstream;
        upstream.onopen = () => {
          if (socket.data.closed) {
            upstream.close();
            return;
          }
          for (const message of socket.data.queue) upstream.send(wire(message));
          socket.data.queue = [];
        };
        upstream.onmessage = (event) => {
          if (!socket.data.closed)
            socket.send(event.data as string | ArrayBuffer);
        };
        upstream.onerror = () => closeBridge(socket);
        upstream.onclose = () => closeBridge(socket);
      },
      message(socket, message) {
        const upstream = socket.data.upstream;
        if (upstream?.readyState === WebSocket.OPEN)
          upstream.send(wire(message));
        else if (socket.data.queue.length < 64) socket.data.queue.push(message);
        else closeBridge(socket);
      },
      close(socket) {
        socket.data.closed = true;
        socket.data.queue = [];
        socket.data.upstream?.close();
      },
    },
  });
}
