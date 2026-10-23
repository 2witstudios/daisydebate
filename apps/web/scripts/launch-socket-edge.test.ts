import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createLaunchSocketEdge } from '../e2e/support/launch-socket-edge';
import {
  createLaunchCertificates,
  readLaunchTls,
} from '../e2e/support/launch-certificates';
setupRitewayBun();

/** A Bun client over real WSS that sends `message` (or closes 1000 'logout' on open) and prints its close. */
async function browserSocket(port: number, ca: string, message: string) {
  const child = Bun.spawn(
    [
      'bun',
      '-e',
      `const socket=new WebSocket(Bun.argv[1]);const timer=setTimeout(()=>process.exit(3),3000);socket.onopen=()=>Bun.argv[2]==='logout'?socket.close(1000,'logout'):socket.send(Bun.argv[2]);socket.onclose=e=>{clearTimeout(timer);console.log(e.code+':'+e.reason);process.exit(0);};`,
      `wss://localhost:${port}/ws`,
      message,
    ],
    {
      env: { ...process.env, NODE_EXTRA_CA_CERTS: ca },
      stdout: 'pipe',
      stderr: 'ignore',
    },
  );
  await child.exited;
  return (await new Response(child.stdout).text()).trim();
}

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
  const call = (message: string) =>
    browserSocket(edge.port!, certificates.ca, message);
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

test('a browser close before the upstream opens reaches the upstream with its code', async () => {
  const certificates = createLaunchCertificates();
  const upgrade = Promise.withResolvers<void>();
  const closed = Promise.withResolvers<string>();
  const upstream = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    // The upstream answers its upgrade only after the browser has closed.
    async fetch(request, server) {
      await upgrade.promise;
      if (server.upgrade(request)) return;
      return new Response(null, { status: 400 });
    },
    websocket: {
      message() {},
      close(_socket, code, reason) {
        closed.resolve(`${code}:${reason}`);
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
  try {
    const browser = await browserSocket(edge.port!, certificates.ca, 'logout');
    upgrade.resolve();
    // A bound for the failure case only: a dropped close never arrives.
    const unseen = setTimeout(() => closed.resolve('never closed'), 3000);
    const received = await closed.promise;
    clearTimeout(unseen);
    assert({
      given:
        'a browser that logs out while the bridge is still dialling upstream',
      should:
        'close the upstream with the browser code and reason once it opens',
      actual: [browser, received],
      expected: ['1000:logout', '1000:logout'],
    });
  } finally {
    edge.stop(true);
    upstream.stop(true);
    certificates.close();
  }
});
