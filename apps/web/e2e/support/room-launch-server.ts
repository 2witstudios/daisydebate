import { resolve } from 'node:path';
import { launchControlPath } from './room-launch-settled';
import { createLaunchControl } from './room-launch-control';
import { createLaunchShutdown } from './room-launch-shutdown';
import { systemClock, systemId } from '@daisy/clock';
import { createApp } from '../../src/server/app';
import { adoptProcessApp } from '../../src/server/process-app';
import { createMailCapture } from './mail-capture';
import { createSelfSignedTlsEdge } from './tls-edge';
import { launchProofPolicy } from './room-launch-policy';
import { requireLaunchSlot } from './room-launch-slot';

const slot = requireLaunchSlot(
  resolve(import.meta.dir, '../../../..'),
  process.env,
);
const capture = createMailCapture({
  port: slot.port + 2,
  redisUrl: process.env.E2E_REDIS_URL!,
  redisNamespace: slot.namespace,
});
const app = createApp({
  env: process.env,
  clock: systemClock,
  ids: systemId,
  fetch: capture.captureFetch,
  roomPolicy: launchProofPolicy,
});
// Adopt before Next loads canonical routes, actions, proxy or instrumentation.
adoptProcessApp(app);
const edge = createSelfSignedTlsEdge({
  appPort: slot.port,
  edgePort: slot.port + 1,
});
const control = createLaunchControl({
  path: launchControlPath(slot.id),
  settled: () => app.auth().settled(),
  pending: () => app.auth().pendingWork(),
});
await import('../../src/server/start');
// start owns drain/auth.settled/close. Local listeners cannot retain the process.
const shutdown = createLaunchShutdown({
  settled: () => app.auth().settled(),
  closeControl: () =>
    new Promise<void>((accept, reject) => {
      control.close((error) => (error ? reject(error) : accept()));
      control.closeAllConnections();
    }),
  stopCapture: () => capture.stop(true),
  stopEdge: () => edge.stop(true),
  refused: () => {
    process.stderr.write(
      `${JSON.stringify({ event: 'room.launch.shutdown', outcome: 'refused' })}\n`,
    );
    process.exitCode = 1;
  },
});
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.once(signal, () => {
    void shutdown();
  });
