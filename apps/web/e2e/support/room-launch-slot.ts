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
