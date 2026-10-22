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

test('validated WSS preserves application close codes in both directions', async () => {
  const certificates = createLaunchCertificates();
  const closes: string[] = [];
  const upstreamClosed = Promise.withResolvers<void>();
  const upstream = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request, server) {
      if (server.upgrade(request)) return;
      return new Response(null, { status: 400 });
    },
    websocket: {
      message(socket, message) {
        if (message === 'restart') socket.close(4006, 'server_restarting');
      },
      close(_socket, code, reason) {
        closes.push(`${code}:${reason}`);
        if (closes.length === 2) upstreamClosed.resolve();
      },
    },
  });
  const edge = createLaunchSocketEdge({
    port: 0,
    upstreamPort: upstream.port!,
    tls: readLaunchTls({
      E2E_LOCAL_TLS_CERT: certificates.cert,
      E2E_LOCAL_TLS_KEY: certificates.key,
    }),
  });
  const call = async (message: string) => {
    const child = Bun.spawn(
      [
        'bun',
        '-e',
        `const socket=new WebSocket(Bun.argv[1]);const timer=setTimeout(()=>process.exit(3),3000);socket.onopen=()=>Bun.argv[2]==='logout'?socket.close(1000,'logout'):socket.send(Bun.argv[2]);socket.onclose=e=>{clearTimeout(timer);console.log(e.code+':'+e.reason);process.exit(0);};`,
        `wss://localhost:${edge.port}/ws`,
        message,
      ],
      {
        env: { ...process.env, NODE_EXTRA_CA_CERTS: certificates.ca },
        stdout: 'pipe',
        stderr: 'ignore',
      },
    );
    await child.exited;
    return (await new Response(child.stdout).text()).trim();
  };
  try {
    const restarted = await call('restart');
    const loggedOut = await call('logout');
    await upstreamClosed.promise;
    assert({
      given:
        'a real WSS bridge whose upstream or browser closes with a policy code',
      should: 'deliver the same code and reason to the other side',
      actual: [restarted, loggedOut, closes.at(-1)],
      expected: ['4006:server_restarting', '1000:logout', '1000:logout'],
    });
  } finally {
    edge.stop(true);
    upstream.stop(true);
    certificates.close();
  }
});
