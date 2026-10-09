import { resolve } from 'node:path';
import { RedisClient, SQL } from 'bun';
import { listNamespaces } from '@daisy/redis/namespaces';
import { TEST_NAMESPACE_PREFIX } from '@daisy/redis/testing';
import { requireLaunchSlot } from './room-launch-slot';

// Invoked only after parent/reviewer release; proof runner always retains data.
try {
  const checkout = resolve(import.meta.dir, '../../../..');
  const slot = requireLaunchSlot(checkout, process.env);
  const dev = new URL(process.env.DATABASE_URL ?? '');
  const test = new URL(process.env.TEST_DATABASE_URL ?? '');
  const testRedis = new URL(process.env.TEST_REDIS_URL ?? '');
  const devRedisUrl = new URL(process.env.REDIS_URL ?? '');
  const e2eRedisUrl = new URL(process.env.E2E_REDIS_URL ?? '');
  if (
    dev.hostname !== 'localhost' ||
    dev.pathname !== `/daisy_wt_${slot.id}` ||
    test.hostname !== dev.hostname ||
    (test.port || '5432') !== (dev.port || '5432') ||
    test.pathname !== `/daisy_wt_${slot.id}_test` ||
    testRedis.hostname !== 'localhost' ||
    devRedisUrl.hostname !== testRedis.hostname ||
    devRedisUrl.pathname !== '/0' ||
    (devRedisUrl.port || '6379') !== (testRedis.port || '6379') ||
    (e2eRedisUrl.port || '6379') !== (testRedis.port || '6379') ||
    Number(testRedis.pathname.slice(1)) !== 2 + (slot.port - 13001) / 10
  )
    throw new Error('Release refuses cross-slot lifecycle services');
  const adminUrl = new URL(dev);
  adminUrl.pathname = '/postgres';
  const admin = new SQL(adminUrl.toString(), { max: 1 });
  const redis = new RedisClient(process.env.E2E_REDIS_URL!);
  const devRedis = new RedisClient(process.env.REDIS_URL!);
  const ownTestRedis = new RedisClient(process.env.TEST_REDIS_URL!);
  try {
    const [before] =
      await admin`select oid::text oid from pg_database where datname='daisy'`;
    if (!before)
      throw new Error('Unrelated main slot sentinel is missing before release');
    // The derived test Redis database owns per-run t3- namespaces, not the dev namespace.
    const runNamespaces = await listNamespaces(
      ownTestRedis,
      TEST_NAMESPACE_PREFIX,
    );
    const removed = Bun.spawn(['bun', 'slot:down'], {
      cwd: checkout,
      env: process.env,
      stdout: 'ignore',
      stderr: 'ignore',
    });
    if ((await removed.exited) !== 0)
      throw new Error('Own slot lifecycle failed');
    const remaining =
      await admin`select datname from pg_database where datname in (${`daisy_wt_${slot.id}`}, ${`daisy_wt_${slot.id}_test`}, ${slot.database}) or starts_with(datname, ${`daisy_wt_${slot.id}_test_run_`})`;
    const [after] =
      await admin`select oid::text oid from pg_database where datname='daisy'`;
    if (remaining.length || before.oid !== after?.oid)
      throw new Error('Slot destruction or unrelated sentinel proof failed');
    const keys = (await devRedis.send('KEYS', [
      `daisy-wt-${slot.id.replaceAll('_', '-')}:*`,
    ])) as string[];
    const e2eKeys = (await redis.send('KEYS', [
      `${slot.namespace}:*`,
    ])) as string[];
    const remainingRunNamespaces = await listNamespaces(
      ownTestRedis,
      TEST_NAMESPACE_PREFIX,
    );
    if (keys.length || e2eKeys.length || remainingRunNamespaces.length)
      throw new Error('Released slot Redis state remains');
    process.stdout.write(
      `${JSON.stringify({ event: 'room.launch.release', slot: slot.id, databasesAbsent: true, namespacesAbsent: true, unrelatedMainSentinelRetained: true, testRedisDatabase: Number(testRedis.pathname.slice(1)), clearedRunNamespaces: runNamespaces.length })}\n`,
    );
  } finally {
    redis.close();
    devRedis.close();
    ownTestRedis.close();
    await admin.close();
  }
} catch {
  process.stderr.write(
    `${JSON.stringify({ event: 'room.launch.release', outcome: 'refused' })}\n`,
  );
  process.exitCode = 1;
}
