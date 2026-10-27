import { nativeSpecArguments } from './affected-projects';
import { browserDriverOptions, finishBrowserDriver } from './browser-driver';
import { admitLaunchCheckout } from './room-launch-admission';
import { resolve } from 'node:path';
import { requireLaunchSlot } from './room-launch-slot';
import { createLaunchCertificates } from './launch-certificates';
import { createLaunchBrowserContainer } from './launch-browser-container';

/** All certificate/container/server/browser work runs within the machine queue. */
export async function runLaunchProof() {
  const checkout = resolve(import.meta.dir, '../../../..');
  const slot = requireLaunchSlot(checkout, process.env);
  await admitLaunchCheckout(checkout, slot.database);
  const config = await import('./room-launch-config');
  const selected = nativeSpecArguments(
    process.env.DAISY_ROOM_LAUNCH_SPECS,
    config.default.testMatch,
  );
  const node = process.env.ROOM_LAUNCH_NODE ?? 'node';
  if (!Bun.spawnSync([node, '--version']).stdout.toString().startsWith('v24.'))
    throw new Error('Launch proof requires the Node 24 browser driver');
  const certificates = createLaunchCertificates();
  let browser: Awaited<ReturnType<typeof createLaunchBrowserContainer>> | null =
    null;
  try {
    browser = await createLaunchBrowserContainer({
      checkout,
      ca: certificates.ca,
      ports: [
        slot.port + 1,
        slot.port + 2,
        slot.port + 3,
        slot.port + 4,
        slot.port + 6,
        7881,
      ],
    });
    const env = {
      ...process.env,
      NODE_EXTRA_CA_CERTS: certificates.ca,
      E2E_LOCAL_TLS_CERT: certificates.cert,
      E2E_LOCAL_TLS_KEY: certificates.key,
      PW_WS_ENDPOINT: browser.endpoint,
    };
    process.stdout.write(
      `${JSON.stringify({ event: 'room.launch.proof', slot: slot.id, database: slot.database, namespace: slot.namespace })}\n`,
    );
    const run = Bun.spawn(
      [
        'bun',
        '../../scripts/heavy.ts',
        node,
        'node_modules/@playwright/test/cli.js',
        'test',
        '--config',
        'e2e/support/room-launch-config.ts',
        ...selected,
        ...Bun.argv.slice(2),
      ],
      browserDriverOptions(checkout, env),
    );
    await finishBrowserDriver(run);
  } finally {
    await browser?.close();
    certificates.close();
  }
}
if (import.meta.main) {
  const checkout = resolve(import.meta.dir, '../../../..');
  const queued = Bun.spawn(
    [
      'bun',
      '../../scripts/heavy.ts',
      'bun',
      'e2e/support/room-launch-queued.ts',
      ...Bun.argv.slice(2),
    ],
    browserDriverOptions(checkout, process.env),
  );
  await finishBrowserDriver(queued);
}
