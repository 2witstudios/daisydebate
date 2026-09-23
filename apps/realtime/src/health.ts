import { withTimeout } from '@daisy/observability';

export type ReadinessResources = {
  readonly draining: boolean;
  readonly database: {
    readonly health: () => Promise<boolean>;
    readonly checkListen: () => Promise<boolean>;
  };
  readonly redis: { readonly health: () => Promise<boolean> };
};
export type ReadinessReport = {
  readonly ready: boolean;
  readonly checks: {
    readonly database: boolean;
    readonly listen: boolean;
    readonly redis: boolean;
  };
};
const settledOk = (result: PromiseSettledResult<boolean>): boolean =>
  result.status === 'fulfilled' && result.value === true;

/** ADR 0031: readiness checks Postgres, LISTEN and Redis, each bounded. */
export async function checkReadiness(
  resources: ReadinessResources,
  timeoutMs = 2000,
): Promise<ReadinessReport> {
  const [database, listen, redis] = await Promise.allSettled([
    withTimeout(resources.database.health(), timeoutMs),
    withTimeout(resources.database.checkListen(), timeoutMs),
    withTimeout(resources.redis.health(), timeoutMs),
  ]);
  const checks = {
    database: settledOk(database),
    listen: settledOk(listen),
    redis: settledOk(redis),
  };
  return {
    ready: !resources.draining && Object.values(checks).every(Boolean),
    checks,
  };
}
