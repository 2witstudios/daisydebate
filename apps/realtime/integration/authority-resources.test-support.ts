import { SQL } from 'bun';
import { createDatabase } from '@daisy/db';
import { systemId, type Clock } from '@daisy/clock';
import { testNamespace } from '@daisy/redis/testing';
import { createRealtimeApp } from '../src/app';
import { testOrigin } from './support';

/** Each instance has its own real pool bound to the existing restricted role. */
export async function authorityResources(
  services: { databaseUrl: string; redisUrl: string },
  clock: Clock,
  maxSubscriptions = 64,
) {
  const client = new SQL(services.databaseUrl, { max: 1 });
  const resources = createRealtimeApp({
    database: createDatabase({
      url: services.databaseUrl,
      client,
      nextActorId: () => systemId.next(),
    }),
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: services.databaseUrl,
      REDIS_URL: services.redisUrl,
      REDIS_NAMESPACE: testNamespace(systemId.next()),
      LOG_LEVEL: 'silent',
      REALTIME_ALLOWED_ORIGINS: testOrigin,
      REALTIME_MAX_SUBSCRIPTIONS: String(maxSubscriptions),
    },
    clock,
    ids: systemId,
  });
  try {
    await client.unsafe('set role daisy_realtime');
    const [runtimeRole] = await client`select current_user as role`;
    if (
      runtimeRole?.role !== 'daisy_realtime' ||
      (await resources.database.runtimeRoleProblems()).length !== 0
    )
      throw new Error('Restricted realtime role binding refused');
    return resources;
  } catch {
    await resources.close();
    throw new Error('Restricted realtime resources unavailable');
  }
}
