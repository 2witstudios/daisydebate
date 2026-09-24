import type { OutboxPosition } from '@daisy/db';
import { withTimeout } from '@daisy/observability';

export type ReadinessResources = {
  readonly isDraining: () => boolean;
  readonly database: {
    readonly health: () => Promise<boolean>;
    readonly checkListen: () => Promise<boolean>;
  };
  readonly redis: { readonly health: () => Promise<boolean> };
  /**
   * The RT-2.3b drain loop's own cursor against a fresh high-water-mark
   * read (ADR 0031/0032: "delivery lag exposed for readiness"). Optional so
   * every existing caller and test that never wires a drain loop is
   * unaffected. Feeds the future cross-instance availability sampler
   * (RT-4.3+); it never gates this instance's own `ready` bit, since no
   * bound is decided at the single-instance level.
   */
  readonly outbox?: {
    readonly cursor: () => OutboxPosition;
    readonly highWaterMark: () => Promise<OutboxPosition>;
  };
};
export type ReadinessReport = {
  readonly ready: boolean;
  readonly checks: {
    readonly database: boolean;
    readonly listen: boolean;
    readonly redis: boolean;
  };
  /** Rows: the high-water mark's `seq` minus the drain cursor's, never negative. `undefined` when unavailable or not wired. */
  readonly deliveryLagRows?: number;
};
const settledOk = (result: PromiseSettledResult<boolean>): boolean =>
  result.status === 'fulfilled' && result.value === true;

async function readDeliveryLag(
  outbox: NonNullable<ReadinessResources['outbox']>,
  timeoutMs: number,
): Promise<number | undefined> {
  try {
    const highWaterMark = await withTimeout(outbox.highWaterMark(), timeoutMs);
    const lag = Number(highWaterMark.seq - outbox.cursor().seq);
    return lag > 0 ? lag : 0;
  } catch {
    return undefined;
  }
}

/** ADR 0031: readiness checks Postgres, LISTEN and Redis, each bounded. */
export async function checkReadiness(
  resources: ReadinessResources,
  timeoutMs = 2000,
): Promise<ReadinessReport> {
  const [database, listen, redis, deliveryLagRows] = await Promise.allSettled([
    withTimeout(resources.database.health(), timeoutMs),
    withTimeout(resources.database.checkListen(), timeoutMs),
    withTimeout(resources.redis.health(), timeoutMs),
    resources.outbox
      ? readDeliveryLag(resources.outbox, timeoutMs)
      : Promise.resolve(undefined),
  ]);
  const checks = {
    database: settledOk(database),
    listen: settledOk(listen),
    redis: settledOk(redis),
  };
  const lag =
    deliveryLagRows.status === 'fulfilled' ? deliveryLagRows.value : undefined;
  return {
    ready: !resources.isDraining() && Object.values(checks).every(Boolean),
    checks,
    ...(lag === undefined ? {} : { deliveryLagRows: lag }),
  };
}
