import { createServer } from 'node:http';
import { chmodSync, rmSync } from 'node:fs';
export type LaunchControlOperation =
  | 'settled'
  | 'block-check-in'
  | 'restore-check-in'
  | 'stop-realtime'
  | 'start-realtime'
  | 'restart-web';
/** An owner-only Unix capability, never mounted on the app's public HTTP ingress. */
export function createLaunchControl(input: {
  readonly path: string;
  readonly settled: () => Promise<void>;
  readonly pending: () => number;
  readonly actions?: Partial<
    Record<Exclude<LaunchControlOperation, 'settled'>, () => Promise<void>>
  >;
}) {
  if (!input.path.startsWith('/') || Buffer.byteLength(input.path) > 103)
    throw new Error('Invalid owned Unix control path');
  const actions: Partial<Record<LaunchControlOperation, () => Promise<void>>> =
    {
      ...input.actions,
      settled: async () => {
        await input.settled();
        if (input.pending() !== 0)
          throw new Error('Proof auth work remains pending');
      },
    };
  const server = createServer((request, response) => {
    const operation = request.url?.slice(1) as LaunchControlOperation;
    const action = Object.hasOwn(actions, operation)
      ? actions[operation]
      : undefined;
    if (request.method !== 'POST' || !action) {
      response.writeHead(404).end();
      return;
    }
    void action().then(
      () => response.writeHead(204).end(),
      () => response.writeHead(503).end(),
    );
  });
  server.once('close', () => rmSync(input.path, { force: true }));
  server.once('listening', () => chmodSync(input.path, 0o600));
  server.listen(`${input.path}`);
  return server;
}
