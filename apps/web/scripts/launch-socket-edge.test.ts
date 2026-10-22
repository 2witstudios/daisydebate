import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createLaunchSocketEdge } from '../e2e/support/launch-socket-edge';
import {
  createLaunchCertificates,
  readLaunchTls,
} from '../e2e/support/launch-certificates';
setupRitewayBun();

test('validated WSS forwards the actual origin and only the authorized realtime socket path', async () => {
  const certificates = createLaunchCertificates();
  const origin = 'https://localhost:13332';
  const seen: string[] = [];
  const upstream = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request, server) {
      seen.push(request.headers.get('origin') ?? 'missing');
      if (server.upgrade(request)) return;
      return new Response(null, { status: 400 });
    },
    websocket: {
      message(socket, message) {
        socket.send(message);
      },
    },
  });
  const edge = createLaunchSocketEdge({
    port: 0,
    upstreamPort: upstream.port!,
    socketPath: '/ws',
    allowedOrigin: origin,
    tls: readLaunchTls({
      E2E_LOCAL_TLS_CERT: certificates.cert,
      E2E_LOCAL_TLS_KEY: certificates.key,
    }),
  });
  const call = async (path: string, requestOrigin: string) => {
    const child = Bun.spawn(
      [
        'bun',
        '-e',
        `const socket=new WebSocket(Bun.argv[1],{headers:{origin:Bun.argv[2]}});const timer=setTimeout(()=>process.exit(3),3000);socket.onopen=()=>socket.send('actual-message');socket.onmessage=e=>{clearTimeout(timer);socket.close();process.exit(e.data==='actual-message'?0:2);};socket.onerror=()=>process.exit(1);`,
        `wss://localhost:${edge.port}${path}`,
        requestOrigin,
      ],
      {
        env: {
          ...process.env,
          NODE_EXTRA_CA_CERTS: certificates.ca,
          NODE_TLS_REJECT_UNAUTHORIZED: undefined,
        },
        stdout: 'ignore',
        stderr: 'ignore',
      },
    );
    return child.exited;
  };
  try {
    assert({
      given: 'a real CA-validated WSS connection through the fixture edge',
      should:
        'forward messages and the unchanged allowed origin while rejecting foreign origins and paths',
      actual: [
        await call('/ws', origin),
        await call('/other', origin),
        await call('/ws', 'https://foreign.example'),
        seen,
      ],
      expected: [0, 1, 1, [origin]],
    });
  } finally {
    edge.stop(true);
    upstream.stop(true);
    certificates.close();
  }
});
