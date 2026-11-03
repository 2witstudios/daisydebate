import { resolve } from 'node:path';
import { createLaunchCertificates } from './launch-certificates';
import { launchLiveKit } from './launch-livekit';
import { requireLaunchSlot } from './room-launch-slot';

/**
 * Runs a command against this checkout's room-launch stack, the composition the
 * Launch proof runs with capture and workers, and stops it after (FLOOR-3). The
 * command gets the driver's target in FLOOR_* variables. Test-only.
 */
const checkout = resolve(import.meta.dir, '../../../..');
const web = resolve(import.meta.dir, '../..');
const slot = requireLaunchSlot(checkout, process.env);
const certificates = createLaunchCertificates();
// Last in every spread: the Launch config reads these from the environment when imported.
const launchEnv = {
  NODE_EXTRA_CA_CERTS: certificates.ca,
  E2E_LOCAL_TLS_CERT: certificates.cert,
  E2E_LOCAL_TLS_KEY: certificates.key,
  PW_WS_ENDPOINT: 'ws://unused.invalid',
};
const stackEnv = { ...process.env, ...launchEnv };
const { default: config } = await import('./room-launch-config');
const server = [config.webServer].flat()[0];
if (!server) throw new Error('Launch server missing');
const stack = Bun.spawn(['sh', '-c', server.command], {
  cwd: server.cwd ?? web,
  env: { ...stackEnv, ...server.env, ...launchEnv },
  stdout: 'inherit',
  stderr: 'inherit',
});
const origin = `https://localhost:${slot.port + 1}`;
let code = 1;
try {
  const until = performance.now() + 120_000;
  for (;;) {
    const ready = await fetch(`${origin}/api/health/ready`, {
      tls: { rejectUnauthorized: false },
    }).catch(() => null);
    if (ready?.ok) break;
    if (stack.exitCode !== null || performance.now() > until)
      throw new Error('Launch stack never became ready');
    await Bun.sleep(250);
  }
  const command = Bun.spawn(Bun.argv.slice(2), {
    cwd: checkout,
    env: {
      ...stackEnv,
      FLOOR_ORIGIN: origin,
      FLOOR_MAIL_CAPTURE_URL: `http://127.0.0.1:${slot.port + 2}`,
      FLOOR_DATABASE_URL: process.env.E2E_DATABASE_URL,
      FLOOR_LIVEKIT_URL: launchLiveKit.url,
      FLOOR_LIVEKIT_SEAT_URL: 'ws://127.0.0.1:7880',
      FLOOR_LIVEKIT_API_KEY: launchLiveKit.apiKey,
      FLOOR_LIVEKIT_API_SECRET: launchLiveKit.apiSecret,
      FLOOR_SERVER_LOGS: resolve(
        web,
        `test-results/room-launch-server-${slot.port}.log`,
      ),
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  code = await command.exited;
} finally {
  stack.kill('SIGTERM');
  await stack.exited;
  certificates.close();
}
process.exit(code);
