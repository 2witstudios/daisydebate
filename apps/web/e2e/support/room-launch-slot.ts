import { basename } from 'node:path';
/** Fail before resource creation. This suite never accepts a shared/main target. */
export function requireLaunchSlot(
  checkout: string,
  env: Readonly<Record<string, string | undefined>>,
) {
  const folder = basename(checkout);
  const id = folder.startsWith('wt-')
    ? folder.slice(3).replaceAll('-', '_')
    : '';
  const database = `daisy_wt_${id}_e2e`;
  const namespace = `daisy-wt-${id.replaceAll('_', '-')}-e2e`;
  const refuse = () => {
    throw new Error('Launch proof requires its dedicated native worktree slot');
  };
  if (!/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(id)) refuse();
  let pg: URL, redis: URL;
  try {
    pg = new URL(env.E2E_DATABASE_URL ?? '');
    redis = new URL(env.E2E_REDIS_URL ?? '');
  } catch {
    return refuse();
  }
  const port = Number(env.E2E_PORT);
  if (
    !validServices(pg, redis, database) ||
    !validRoleAndPort(pg, env.DATABASE_URL) ||
    env.E2E_REDIS_NAMESPACE !== namespace ||
    !validPort(port)
  )
    refuse();
  return { id, database, namespace, port };
}

const loopback = (host: string) =>
  ['localhost', '127.0.0.1', '[::1]'].includes(host);
const validPort = (port: number) =>
  Number.isInteger(port) &&
  port >= 13001 &&
  port <= 17991 &&
  (port - 13001) % 10 === 0;
const validServices = (pg: URL, redis: URL, database: string) =>
  ['postgres:', 'postgresql:'].includes(pg.protocol) &&
  loopback(pg.hostname) &&
  pg.pathname === `/${database}` &&
  redis.protocol === 'redis:' &&
  loopback(redis.hostname) &&
  redis.pathname === '/2';

function validRoleAndPort(pg: URL, value: string | undefined) {
  try {
    const admin = new URL(value ?? '');
    return (
      pg.username === 'daisy_e2e' &&
      !pg.search &&
      !pg.hash &&
      (pg.port || '5432') === (admin.port || '5432') &&
      pg.hostname === admin.hostname
    );
  } catch {
    return false;
  }
}

/** Admit only the derived slot's canonical lifecycle service URLs. */
export function requireLaunchReleaseServices(
  slot: ReturnType<typeof requireLaunchSlot>,
  env: Readonly<Record<string, string | undefined>>,
) {
  const dev = new URL(env.DATABASE_URL ?? '');
  const test = new URL(env.TEST_DATABASE_URL ?? '');
  const testRedis = new URL(env.TEST_REDIS_URL ?? '');
  const devRedisUrl = new URL(env.REDIS_URL ?? '');
  const e2eRedisUrl = new URL(env.E2E_REDIS_URL ?? '');
  if (
    !validReleasePostgres(dev, test, slot.id) ||
    !validReleaseRedis(devRedisUrl, testRedis, e2eRedisUrl, slot.port)
  )
    throw new Error('Release refuses cross-slot lifecycle services');
  return dev;
}

function validReleasePostgres(dev: URL, test: URL, id: string) {
  return (
    dev.hostname === 'localhost' &&
    dev.pathname === `/daisy_wt_${id}` &&
    test.hostname === dev.hostname &&
    (test.port || '5432') === (dev.port || '5432') &&
    test.pathname === `/daisy_wt_${id}_test`
  );
}

function validReleaseRedis(dev: URL, test: URL, e2e: URL, port: number) {
  return (
    test.hostname === 'localhost' &&
    dev.hostname === test.hostname &&
    ['', '/0'].includes(dev.pathname) &&
    (dev.port || '6379') === (test.port || '6379') &&
    (e2e.port || '6379') === (test.port || '6379') &&
    Number(test.pathname.slice(1)) === 2 + (port - 13001) / 10
  );
}
