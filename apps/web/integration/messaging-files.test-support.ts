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
