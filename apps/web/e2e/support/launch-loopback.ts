import { connect } from 'node:net';
import { networkInterfaces } from 'node:os';
import { resolve } from 'node:path';
import { expect } from './fixtures';
import { requireLaunchSlot } from './room-launch-slot';

/** This host's first non-loopback IPv4 address, the one its local network reaches. */
function externalAddress() {
  const address = Object.values(networkInterfaces())
    .flat()
    .find((entry) => entry?.family === 'IPv4' && !entry.internal)?.address;
  if (!address)
    throw new Error('No non-loopback interface to prove loopback binding');
  return address;
}

const reach = (host: string, port: number) =>
  new Promise<'open' | 'refused'>((done, fail) => {
    const socket = connect({ host, port, timeout: 2000 });
    socket.once('connect', () => {
      socket.destroy();
      done('open');
    });
    socket.once('error', (error: NodeJS.ErrnoException) =>
      error.code === 'ECONNREFUSED' ? done('refused') : fail(error),
    );
    socket.once('timeout', () => {
      socket.destroy();
      fail(new Error(`Probe of ${host}:${port} timed out`));
    });
  });

/** The plaintext web, realtime and web-peer upstreams answer loopback only; their TLS edges are the ingress (ISSUE-480). */
export async function proveLoopbackUpstreams() {
  const { port } = requireLaunchSlot(
    resolve(import.meta.dirname, '../../../..'),
    process.env,
  );
  const upstreams = [port, port + 3, port + 5];
  const host = externalAddress();
  expect({
    loopback: await reach('127.0.0.1', port),
    external: await Promise.all(upstreams.map((each) => reach(host, each))),
  }).toEqual({
    loopback: 'open',
    external: upstreams.map(() => 'refused'),
  });
}
