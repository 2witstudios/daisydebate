import { resolve } from 'node:path';
import { systemClock, systemId } from '@daisy/clock';
import { createApp } from '../../src/server/app';
import { adoptProcessApp } from '../../src/server/process-app';
import { createMailCapture } from './mail-capture';
import { launchProofPolicy } from './room-launch-policy';
import { requireLaunchSlot } from './room-launch-slot';
import { launchAppControlPath } from './room-launch-settled';
import { createLaunchControl } from './room-launch-control';

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
adoptProcessApp(app);
const control = createLaunchControl({
  path: launchAppControlPath(slot.id),
  settled: () => app.auth().settled(),
  pending: () => app.auth().pendingWork(),
});
// The production entry owns availability, competitive workers, drain and pool close.
await import('../../src/server/start');
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.once(signal, () => {
    capture.stop(true);
    control.close();
    control.closeAllConnections();
  });
