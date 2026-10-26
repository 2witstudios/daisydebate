import type { ServerWebSocket, WebSocketOptions } from 'bun';

type Bridge = {
  upstream: WebSocket | null;
  url: string;
  origin: string | null;
  closed: boolean;
  /** The browser's close, kept until the upstream it raced has opened. */
  closing: { code: number; reason: string } | null;
  queue: (string | Buffer)[];
};
const wire = (message: string | Buffer) =>
  typeof message === 'string' ? message : Uint8Array.from(message);
// Only 1000 and application codes may be sent; the realtime client policy reads them.
const sendable = (code: number) =>
  code === 1000 || (code >= 3000 && code < 5000);
const closeBridge = (
  socket: ServerWebSocket<Bridge>,
  code = 1001,
  reason = 'Connection closed',
) => {
  socket.data.closed = true;
  socket.data.queue = [];
  socket.data.upstream?.close();
  if (sendable(code)) socket.close(code, reason);
  else socket.close(1001, 'Connection closed');
};
/** Closes upstream with the browser's code when it may be sent on. */
const closeUpstream = (
  upstream: WebSocket,
  closing: { code: number; reason: string } | null,
) => {
  if (closing && sendable(closing.code))
    upstream.close(closing.code, closing.reason);
  else upstream.close();
};
// The web tsconfig's DOM lib hides Bun's client options; the bridge runs under Bun.
const UpstreamSocket = WebSocket as unknown as new (
  url: string,
  options: WebSocketOptions,
) => WebSocket;
type EdgeScope = {
  readonly socketPath?: string;
  readonly allowedOrigin?: string;
};
const refusal = (scope: EdgeScope, request: Request, path: string) => {
  if (scope.socketPath && path !== scope.socketPath)
    return new Response('Not found', { status: 404 });
  if (
    scope.allowedOrigin &&
    request.headers.get('origin') !== scope.allowedOrigin
  )
    return new Response('Forbidden', { status: 403 });
  return null;
};
/** Trusted TLS forwarding to actual suite-owned signalling and realtime services. */
export function createLaunchSocketEdge(
  input: EdgeScope & {
    readonly port: number;
    readonly upstreamPort: number;
    readonly tls: { key: Buffer; cert: Buffer };
  },
) {
  return Bun.serve<Bridge>({
    hostname: '127.0.0.1',
    port: input.port,
    tls: input.tls,
    async fetch(request, server) {
      const url = new URL(request.url),
        target = new URL(
          `http://127.0.0.1:${input.upstreamPort}${url.pathname}${url.search}`,
        );
      const refused = refusal(input, request, url.pathname);
      if (refused) return refused;
      if (request.headers.get('upgrade')?.toLowerCase() === 'websocket') {
        target.protocol = 'ws:';
        if (
          server.upgrade(request, {
            data: {
              upstream: null,
              url: target.href,
              origin: request.headers.get('origin'),
              closed: false,
              closing: null,
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
        const upstream = new UpstreamSocket(socket.data.url, {
          headers: socket.data.origin ? { origin: socket.data.origin } : {},
        });
        upstream.binaryType = 'arraybuffer';
        socket.data.upstream = upstream;
        upstream.onopen = () => {
          if (socket.data.closed) {
            closeUpstream(upstream, socket.data.closing);
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
        upstream.onclose = (event) =>
          closeBridge(socket, event.code, event.reason);
      },
      message(socket, message) {
        const upstream = socket.data.upstream;
        if (upstream?.readyState === WebSocket.OPEN)
          upstream.send(wire(message));
        else if (socket.data.queue.length < 64) socket.data.queue.push(message);
        else closeBridge(socket);
      },
      close(socket, code, reason) {
        socket.data.closed = true;
        socket.data.queue = [];
        socket.data.closing = { code, reason };
        // Closing a still-connecting socket fails it (1006 upstream); onopen
        // applies the kept close instead.
        const upstream = socket.data.upstream;
        if (upstream?.readyState === WebSocket.OPEN)
          closeUpstream(upstream, socket.data.closing);
      },
    },
  });
}
