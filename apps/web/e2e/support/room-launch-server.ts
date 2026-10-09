import { resolve } from 'node:path';
import { rmSync } from 'node:fs';
import { launchControlPath } from './room-launch-settled';
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
const control = Bun.serve({
  hostname: '127.0.0.1',
  unix: launchControlPath(slot.id),
  async fetch(request) {
    if (
      new URL(request.url).pathname !== '/settled' ||
      request.method !== 'POST'
    )
      return new Response(null, { status: 404 });
    await app.auth().settled();
    return new Response(null, {
      status: app.auth().pendingWork() === 0 ? 204 : 503,
    });
  },
});
await import('../../src/server/start');
// start owns drain/auth.settled/close. Local listeners cannot retain the process.
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.once(signal, () => {
    void app
      .auth()
      .settled()
      .then(() => {
        control.stop(true);
        rmSync(launchControlPath(slot.id), { force: true });
        capture.stop(true);
        edge.stop(true);
      });
  });
