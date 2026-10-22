import { resolve } from 'node:path';
import { createApp } from '../../src/server/app';
import { adoptProcessApp } from '../../src/server/process-app';
import { launchMailFetch, launchMailPath } from './launch-mail';
import { launchAppInput } from './room-launch-app-input';
import { requireLaunchSlot } from './room-launch-slot';
import { launchAppControlPath } from './room-launch-settled';
import { createLaunchControl } from './room-launch-control';

const slot = requireLaunchSlot(
  resolve(import.meta.dir, '../../../..'),
  process.env,
);
if (Bun.argv[2] !== undefined && Bun.argv[2] !== 'peer')
  throw new Error('Unknown owned web process');
const peer = Bun.argv[2] === 'peer';
const app = createApp(
  launchAppInput(process.env, launchMailFetch(launchMailPath(slot.id))),
);
adoptProcessApp(app);
const control = createLaunchControl({
  path: launchAppControlPath(slot.id, peer),
  settled: () => app.auth().settled(),
  pending: () => app.auth().pendingWork(),
});
// The production entry owns availability, competitive workers, drain and pool close.
await import('../../src/server/start');
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.once(signal, () => {
    control.close();
    control.closeAllConnections();
  });
