import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { systemClock, systemId } from '@daisy/clock';
import { createRealtimeApp } from '../src/app';
import { serveRealtime } from '../src/serve';

// Dedicated native-slot fixture only. No identity, membership or policy override.
const folder = basename(resolve(import.meta.dir, '../../..'));
const slot = folder.startsWith('wt-')
  ? folder.slice(3).replaceAll('-', '_')
  : '';
const database = new URL(process.env.DATABASE_URL ?? '');
const redis = new URL(process.env.REDIS_URL ?? '');
const port = Number(process.env.REALTIME_PORT);
if (
  !/^[a-z0-9_]+$/.test(slot) ||
  !['localhost', '127.0.0.1'].includes(database.hostname) ||
  database.pathname !== `/daisy_wt_${slot}_e2e` ||
  !['localhost', '127.0.0.1'].includes(redis.hostname) ||
  redis.pathname !== '/2' ||
  process.env.REDIS_NAMESPACE !== `daisy-wt-${slot.replaceAll('_', '-')}-e2e` ||
  !Number.isInteger(port) ||
  port < 13004 ||
  port > 17994 ||
  process.env.REALTIME_PUBLIC_URL !== `wss://localhost:${port}/ws`
)
  throw new Error(
    'Realtime browser fixture requires its exact native test slot',
  );

const directory = mkdtempSync(join(tmpdir(), 'daisy-realtime-tls-'));
let key: Buffer, cert: Buffer;
try {
  const keyPath = join(directory, 'private.pem');
  const certificate = Bun.spawnSync(
    [
      'openssl',
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '1',
      '-keyout',
      keyPath,
      '-subj',
      '/CN=localhost',
      '-addext',
      'subjectAltName=DNS:localhost',
    ],
    { stdout: 'pipe', stderr: 'ignore' },
  );
  if (certificate.exitCode !== 0)
    throw new Error('Realtime fixture certificate unavailable');
  key = readFileSync(keyPath);
  cert = certificate.stdout;
} finally {
  rmSync(directory, { recursive: true, force: true });
}
const resources = createRealtimeApp({
  env: process.env,
  clock: systemClock,
  ids: systemId,
});
const runtime = await serveRealtime({
  resources,
  port,
  hostname: '127.0.0.1',
  serve: ((options) =>
    Bun.serve({
      ...options,
      hostname: '127.0.0.1',
      tls: { key, cert },
    })) as typeof Bun.serve,
});
let closing: Promise<void> | undefined;
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.once(signal, () => {
    closing ??= runtime.close().then(() => resources.close());
    void closing.catch(() => {
      process.exitCode = 1;
    });
  });
