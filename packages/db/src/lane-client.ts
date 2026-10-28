import type { ReservedSQL, SQL } from 'bun';
import { createAppError } from '@daisy/errors';
import type { LaneGate, LaneRelease } from './workload-admission';

type Settles<T> = PromiseLike<T> & {
  readonly values: () => Promise<unknown>;
  readonly catch: Promise<T>['catch'];
  readonly finally: Promise<T>['finally'];
};
type LazyQuery = PromiseLike<unknown> & { values(): PromiseLike<unknown> };

const unsupported = (property: PropertyKey) => () => {
  throw createAppError(
    'INVARIANT',
    `A lane-bound client does not offer ${String(property)}`,
  );
};
/**
 * The one pool member a lane passes through unadmitted: Drizzle reads and
 * sets its parsers and serializers when it builds the lane's handle. Every
 * other member a lane does not admit below is refused, so a member Bun adds
 * later is closed until someone admits it here.
 */
const PASSED = 'options';

async function holding<T>(
  admit: () => Promise<LaneRelease>,
  work: () => PromiseLike<T>,
): Promise<T> {
  const release = await admit();
  try {
    return await work();
  } finally {
    release();
  }
}

/**
 * A query Drizzle builds lazily: it runs once awaited (or through
 * `values()`), only after the lane admits it, and its connection returns
 * to the lane when the query settles.
 */
function admittedQuery(
  admit: () => Promise<LaneRelease>,
  make: () => LazyQuery,
): Settles<unknown> {
  let rows: Promise<unknown> | undefined;
  const result = () => (rows ??= holding(admit, make));
  return {
    then: (fulfilled, rejected) => result().then(fulfilled, rejected),
    catch: (rejected) => result().catch(rejected),
    finally: (settled) => result().finally(settled),
    values: () => holding(admit, () => make().values()),
  };
}

/** A reserved connection whose release or destruction also returns its lane slot. */
function admittedReservation(
  reserved: ReservedSQL,
  release: LaneRelease,
): ReservedSQL {
  return new Proxy(reserved, {
    get(target, property, receiver) {
      if (property === 'release')
        return () => {
          try {
            target.release();
          } finally {
            release();
          }
        };
      if (property === 'close')
        return async (options?: { timeout?: number }) => {
          try {
            await target.close(options);
          } finally {
            release();
          }
        };
      const value: unknown = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

/**
 * The only SQL handle a lane hands out (ADR 0088). Every top-level query,
 * transaction and reservation waits for the lane's gate and holds its slot
 * until it settles; work inside a transaction or reservation already holds
 * its connection. Anything else (close, LISTEN, NOTIFY, distributed
 * transactions, members Bun adds later) stays with the owner and is refused.
 */
export function laneClient(
  pool: SQL,
  gate: LaneGate,
  fairnessKey: () => string | undefined = () => undefined,
): SQL {
  const admit = () => gate.admit(1, fairnessKey());
  const members: Record<PropertyKey, unknown> = {
    unsafe: (...args: Parameters<SQL['unsafe']>) =>
      admittedQuery(admit, () => pool.unsafe(...args)),
    begin: (...args: unknown[]) =>
      holding(admit, () =>
        (pool.begin as (...input: unknown[]) => Promise<unknown>)(...args),
      ),
    transaction: (...args: unknown[]) =>
      holding(admit, () =>
        (pool.begin as (...input: unknown[]) => Promise<unknown>)(...args),
      ),
    reserve: async (...args: Parameters<SQL['reserve']>) => {
      const release = await admit();
      try {
        return admittedReservation(await pool.reserve(...args), release);
      } catch (error) {
        release();
        throw error;
      }
    },
  };
  return new Proxy(pool, {
    apply: (target, thisArg, args: unknown[]) =>
      admittedQuery(
        admit,
        () => Reflect.apply(target, thisArg, args) as LazyQuery,
      ),
    get(target, property, receiver) {
      if (Object.hasOwn(members, property)) return members[property];
      if (property === PASSED) return Reflect.get(target, property, receiver);
      // Absent, not refusing: a lane client is no thenable (an async function
      // may return it) and has no symbol protocol (disposal, coercion).
      if (property === 'then' || typeof property === 'symbol') return undefined;
      return unsupported(property);
    },
  });
}
