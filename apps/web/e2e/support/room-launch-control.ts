import { createServer } from 'node:http';
import { writeFileSync, rmSync } from 'node:fs';
/** Loopback-only ephemeral control; the owned descriptor contains no credentials. */
export function createLaunchControl({
  path,
  settled,
  pending,
}: {
  readonly path: string;
  readonly settled: () => Promise<void>;
  readonly pending: () => number;
}) {
  const server = createServer((request, response) => {
    if (request.url !== '/settled' || request.method !== 'POST') {
      response.writeHead(404).end();
      return;
    }
    void settled().then(
      () => {
        response.writeHead(pending() === 0 ? 204 : 503).end();
      },
      () => response.writeHead(503).end(),
    );
  });
  server.once('close', () => rmSync(path, { force: true }));
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (address === null || typeof address === 'string')
      throw new Error('Invalid proof control listener');
    writeFileSync(path, JSON.stringify({ port: address.port }), {
      flag: 'wx',
      mode: 0o600,
    });
  });
  return server;
}
