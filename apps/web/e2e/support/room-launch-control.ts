import { createServer } from 'node:http';
import { chmodSync, lstatSync, rmSync } from 'node:fs';
import { connect } from 'node:net';
export type LaunchControlOperation =
  | 'settled'
  | 'block-check-in'
  | 'restore-check-in'
  | 'stop-realtime'
  | 'start-realtime'
  | 'stop-web'
  | 'start-web'
  | 'start-web-peer'
  | 'stop-web-peer'
  | 'use-web-peer'
  | 'use-primary-web'
  | 'restart-web';
/** An owner-only Unix capability, never mounted on the app's public HTTP ingress. */
export async function createLaunchControl(input: {
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
  // Refused before listening, so a failed listen never removes a live socket.
  if (await socketInUse(input.path))
    throw Object.assign(new Error('Launch control socket is in use'), {
      code: 'EADDRINUSE',
    });
  server.once('close', () => rmSync(input.path, { force: true }));
  server.once('listening', () => chmodSync(input.path, 0o600));
  server.listen(`${input.path}`);
  return server;
}

/**
 * Whether a live listener answers on the path. A run killed before its close
 * leaves its socket file behind (ISSUE-492); a socket that refuses connection
 * is that leftover and is removed. Anything else at the path is left alone.
 */
async function socketInUse(path: string) {
  let socket: boolean;
  try {
    socket = lstatSync(path).isSocket();
  } catch {
    return false;
  }
  if (!socket) return true;
  const live = await new Promise<boolean>((answer) => {
    const probe = connect(path);
    probe.once('connect', () => {
      probe.destroy();
      answer(true);
    });
    probe.once('error', (error: NodeJS.ErrnoException) =>
      answer(error.code !== 'ECONNREFUSED'),
    );
  });
  if (!live) rmSync(path);
  return live;
}
