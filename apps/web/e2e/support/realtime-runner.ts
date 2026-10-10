import { resolve } from 'node:path';
import { requireLaunchSlot } from './room-launch-slot';
import { admitLaunchCheckout } from './room-launch-admission';
import {
  realtimeProofProfile,
  assertRealtimeProofConfig,
} from './realtime-profile';

// Both profiles use the exact native slot, real authorization and native TLS process.
if (Bun.argv.length !== 3)
  throw new Error('Realtime proof refuses additional runner arguments');
const profile = realtimeProofProfile(Bun.argv[2]);
const checkout = resolve(import.meta.dir, '../../../..');
const slot = requireLaunchSlot(checkout, process.env);
const selected =
  Bun.argv[2] === 'room'
    ? await import('./realtime-config')
    : await import('./messaging-realtime-config');
assertRealtimeProofConfig(profile, selected.default);
await admitLaunchCheckout(checkout, slot.database);
const node = process.env.REALTIME_BROWSER_NODE ?? 'node';
if (!Bun.spawnSync([node, '--version']).stdout.toString().startsWith('v24.'))
  throw new Error('Realtime proof requires the Node 24 browser driver');
const child = Bun.spawn(
  [
    'bun',
    '../../scripts/e2e-limit.ts',
    node,
    'node_modules/@playwright/test/cli.js',
    'test',
    '--config',
    profile.config,
  ],
  {
    cwd: resolve(checkout, 'apps/web'),
    env: process.env,
    stdout: 'inherit',
    stderr: 'inherit',
  },
);
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.once(signal, () => child.kill(signal));
process.exitCode = await child.exited;
// Retain this slot's rows and reports for the assigned independent reviewer.
