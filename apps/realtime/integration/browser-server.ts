import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { systemClock, systemId } from '@daisy/clock';
import { SQL } from 'bun';
import { createDatabase } from '@daisy/db';
import {
  messagingTestReading,
  messagingTestGroupReading,
} from '@daisy/auth/testing';
import { createRealtimeApp } from '../src/app';
import { serveRealtime } from '../src/serve';
import { browserRuntimeTarget } from './browser-runtime-target';

// Dedicated native-slot fixture with explicit test-only DM/group reading evidence.
// Durable identity/membership and canonical authorization remain authoritative.
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
// The browser login is deliberately not a member of the runtime role. Reuse
// only this native slot's existing isolated test administrator for SET ROLE;
// the runtime connection then performs every query as daisy_realtime.
const runtimeUrl = browserRuntimeTarget(
  process.env.TEST_DATABASE_URL ?? '',
  process.env.DATABASE_URL!,
  slot,
);
const runtimeClient = new SQL(runtimeUrl, { max: 1 });
try {
  await runtimeClient.unsafe('set role daisy_realtime');
  const [binding] = await runtimeClient`select current_user as role`;
  if (binding?.role !== 'daisy_realtime')
    throw new Error('Realtime browser runtime role binding refused');
} catch {
  await runtimeClient.close();
  throw new Error('Realtime browser runtime role unavailable');
}
const runtimeDatabase = createDatabase({
  url: runtimeUrl,
  client: runtimeClient,
  nextActorId: () => systemId.next(),
});
const resources = createRealtimeApp({
  database: runtimeDatabase,
  env: process.env,
  clock: systemClock,
  ids: systemId,
});
const runtime = await serveRealtime({
  resources,
  readingPolicy: (input) =>
    input.channel.authority.kind === 'private_group'
      ? messagingTestGroupReading(input)
      : messagingTestReading(input),
  port,
  hostname: '127.0.0.1',
  tls: { key, cert },
}).catch(async () => {
  await resources.close();
  throw new Error('Realtime browser listener unavailable');
});
let closing: Promise<void> | undefined;
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.once(signal, () => {
    closing ??= runtime.close().then(() => resources.close());
    void closing.catch(() => {
      process.exitCode = 1;
    });
  });
