import { connect, createServer, type Socket } from 'node:net';
/** Owned byte relay around actual clamd; outage leaves every shared service untouched. */
export async function openFileScannerRelay(target: {
  host: string;
  port: number;
}) {
  let paused = false;
  const connections = new Set<Socket>();
  const server = createServer((client) => {
    if (paused) {
      client.destroy();
      return;
    }
    const upstream = connect(target);
    for (const socket of [client, upstream]) {
      connections.add(socket);
      socket.on('close', () => connections.delete(socket));
      socket.on('error', () => {
        client.destroy();
        upstream.destroy();
      });
    }
    client.pipe(upstream);
    upstream.pipe(client);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Private scanner relay requires TCP');
  return {
    host: '127.0.0.1',
    port: address.port,
    pause() {
      paused = true;
      for (const socket of connections) socket.destroy();
    },
    resume() {
      paused = false;
    },
    async close() {
      for (const socket of connections) socket.destroy();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

export function requireFileScannerPort(value: string | undefined): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error(
      'CLAMD_TEST_PORT must name the isolated local clamd service',
    );
  return port;
}

/** Pauses only completion of an actual daemon scan; no classification is fabricated. */
export function controlledFileScan(
  scanner: import('../src/features/messaging/files/ports').FileScanner,
) {
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>((done) => {
    enter = done;
  });
  const released = new Promise<void>((done) => {
    release = done;
  });
  return {
    scanner: {
      async scan(
        bytes: Uint8Array,
        limits: { maxBytes: number; serviceMs: number },
      ) {
        const result = await scanner.scan(bytes, limits);
        enter();
        await released;
        return result;
      },
    },
    waitForScan: (finalizing: Promise<unknown>) =>
      Promise.race([
        entered,
        finalizing.then(() => {
          throw new Error('Expected controlled scan before attachment');
        }),
      ]),
    release,
  };
}
