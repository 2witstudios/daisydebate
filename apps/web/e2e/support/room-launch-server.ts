import { resolve } from 'node:path';
import {
  launchControlPath,
  launchAppControlPath,
  callLaunchControl,
} from './room-launch-settled';
import { createLaunchControl } from './room-launch-control';
import { createSelfSignedTlsEdge } from './tls-edge';
import { readLaunchTls } from './launch-certificates';
import { requireLaunchSlot } from './room-launch-slot';
import { createLaunchProcess } from './launch-process';
import { createLaunchProbeResource } from './launch-probe-room';
import { createLaunchMediaEdge } from './launch-media-edge';
import { resolveRealtimeNamespace } from '../../playwright.config';

const checkout = resolve(import.meta.dir, '../../../..');
const slot = requireLaunchSlot(checkout, process.env);
const origin = `https://localhost:${slot.port + 1}`;
const tls = readLaunchTls(process.env);
let blocked = false,
  ready = false;
const edge = createSelfSignedTlsEdge({
  appPort: slot.port,
  edgePort: slot.port + 1,
  tls,
  beforeForward: (request) => {
    const path = new URL(request.url).pathname;
    if (
      (!ready && path === '/api/health/ready') ||
      (blocked && /^\/api\/rounds\/[^/]+\/check-in$/.test(path))
    )
      return new Response('Public ingress unavailable', { status: 503 });
    return null;
  },
});
const mediaEdge = createLaunchMediaEdge({ port: slot.port + 4, tls });
const health = async (url: string) => {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(1000) })).ok;
  } catch {
    return false;
  }
};
const appCommand = ['bun', resolve(import.meta.dir, 'room-launch-app.ts')];
const webEnv = { ...process.env };
const web = createLaunchProcess({
  command: appCommand,
  cwd: resolve(checkout, 'apps/web'),
  env: webEnv,
  ready: () => health(`http://127.0.0.1:${slot.port}/api/health/ready`),
});
const realtime = createLaunchProcess({
  command: ['bun', 'src/start.ts'],
  cwd: resolve(checkout, 'apps/realtime'),
  env: {
    ...process.env,
    REALTIME_PORT: String(slot.port + 3),
    REALTIME_ALLOWED_ORIGINS: origin,
    REDIS_NAMESPACE: resolveRealtimeNamespace(process.env),
  },
  ready: () => health(`http://127.0.0.1:${slot.port + 3}/health/live`),
});
const control = createLaunchControl({
  path: launchControlPath(slot.id),
  settled: () => callLaunchControl(launchAppControlPath(slot.id), 'settled'),
  pending: () => 0,
  actions: {
    'block-check-in': async () => {
      blocked = true;
    },
    'restore-check-in': async () => {
      blocked = false;
    },
    'stop-realtime': realtime.stop,
    'start-realtime': realtime.start,
    'restart-web': web.restart,
  },
});
let closing: Promise<void> | null = null;
const shutdown = () =>
  (closing ??= (async () => {
    ready = false;
    const outcomes = await Promise.allSettled([web.stop(), realtime.stop()]);
    edge.stop(true);
    mediaEdge.stop(true);
    await new Promise<void>((accept) => {
      control.close(() => accept());
      control.closeAllConnections();
    });
    if (outcomes.some((outcome) => outcome.status === 'rejected'))
      process.exitCode = 1;
  })());
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.once(signal, () => {
    void shutdown();
  });
try {
  await Promise.all([web.start(), realtime.start()]);
  const probe = await createLaunchProbeResource(origin, slot.port + 2);
  // A normal temporary production instance created the signed resource; the final instance receives it before createApp.
  await web.stop();
  webEnv.ATTENDANCE_PUBLIC_PROBE = JSON.stringify(probe);
  await web.start();
  ready = true;
} catch {
  process.stderr.write(
    `${JSON.stringify({ event: 'room.launch.startup', outcome: 'refused' })}\n`,
  );
  process.exitCode = 1;
  await shutdown();
}
