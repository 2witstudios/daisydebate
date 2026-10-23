import { createMediaWorkerAuthentication } from './worker-auth';
import { createMediaWorkerClient } from './worker-client';
export const scope = {
  roundId: 'r'.repeat(24),
  sessionId: 's'.repeat(24),
  workerId: 'w'.repeat(24),
};
const authentication = createMediaWorkerAuthentication({
  secret: Buffer.alloc(32, 6).toString('base64url'),
  now: () => 1000,
});
/** A worker client against a real local server answering `reply` per call. */
export function localClient(
  reply: (call: number) => Response,
  deadlineSignal = () => AbortSignal.timeout(2000),
) {
  let calls = 0;
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () => reply(++calls),
  });
  return {
    client: createMediaWorkerClient({
      scope,
      authentication,
      url: `http://127.0.0.1:${server.port}`,
      fetch,
      nowMs: performance.now,
      deadlineSignal,
      unavailableRetryMs: [0, 0],
    }),
    calls: () => calls,
    close: () => server.stop(true),
  };
}
