import { resolve } from 'node:path';
import { requireLaunchSlot } from './room-launch-slot';

/** Run only from a freshly allocated dedicated native proof checkout. */
const checkout = resolve(import.meta.dir, '../../../..');
const slot = requireLaunchSlot(checkout, process.env);
process.stdout.write(
  `${JSON.stringify({ event: 'room.launch.proof', slot: slot.id, database: slot.database, namespace: slot.namespace })}\n`,
);
const node = process.env.ROOM_LAUNCH_NODE ?? 'node';
const version = Bun.spawnSync([node, '--version']);
if (!version.stdout.toString().startsWith('v24.'))
  throw new Error('Launch proof requires the Node 24 browser driver');
const run = Bun.spawn(
  [
    'bun',
    '../../scripts/e2e-limit.ts',
    node,
    'node_modules/@playwright/test/cli.js',
    'test',
    '--config',
    'e2e/support/room-launch-config.ts',
    ...Bun.argv.slice(2),
  ],
  {
    cwd: resolve(checkout, 'apps/web'),
    env: process.env,
    stdout: 'inherit',
    stderr: 'inherit',
  },
);
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.once(signal, () => run.kill(signal));
process.exitCode = await run.exited;
// No row cleanup or reset: retain history for parent/reviewer release.
