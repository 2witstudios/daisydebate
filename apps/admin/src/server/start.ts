import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import next from 'next';
import { roleRefusal, schemaPowers } from '../db/runtime-role';
import { gateRequest, PEER_HEADER } from './gate';
import { adminRuntime } from './runtime';

/**
 * The admin process (ADR 0076). It refuses a schema-altering database role
 * before serving, then answers every request through the Host gate; Next
 * renders only what the gate admits. Production binds `[::]:8080`, which
 * `fly proxy 4800:8080` reaches over 6PN; there is no public service.
 */
export const SHUTDOWN_DEADLINE_MS = 10_000;

const { config, database, logger } = adminRuntime();
const refusal = roleRefusal(config.NODE_ENV, await schemaPowers(database.db));
if (refusal) {
  await database.close();
  throw new Error(refusal);
}
const app = next({
  dev: config.NODE_ENV !== 'production',
  // Next's own redirect fetches go to the canonical origin's host and port.
  hostname: 'localhost',
  port: config.ADMIN_PORT,
  dir: fileURLToPath(new URL('../..', import.meta.url)),
});
const handle = app.getRequestHandler();
await app.prepare();

const server = createServer((request, response) => {
  const decision = gateRequest({
    host: request.headers.host,
    socketAddress: request.socket.remoteAddress,
  });
  if (!decision.admit) {
    response.writeHead(decision.status, { 'content-type': 'text/plain' });
    response.end('Misdirected request');
    return;
  }
  request.headers[PEER_HEADER] = decision.peer;
  void handle(request, response);
});
server.once('listening', () =>
  logger.log(
    'server.start',
    { port: config.ADMIN_PORT, source: 'admin' },
    'Admin server listening',
  ),
);
server.listen({ port: config.ADMIN_PORT, host: config.ADMIN_HOST });

const stop = async () => {
  const deadline = setTimeout(() => process.exit(1), SHUTDOWN_DEADLINE_MS);
  deadline.unref();
  server.close();
  await app.close();
  await database.close();
  logger.log('server.shutdown', { source: 'admin' }, 'Admin server stopped');
  process.exit(0);
};
process.once('SIGTERM', () => void stop());
process.once('SIGINT', () => void stop());
