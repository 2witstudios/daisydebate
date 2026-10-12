import { createAppError } from '@daisy/errors';

export type DatabaseWorkload =
  | 'competitive'
  | 'social'
  | 'search'
  | 'admission'
  | 'renewal'
  | 'control'
  | 'headers'
  | 'projection'
  | 'relay'
  | 'ephemeral';

/** Non-borrowable reservations count actual work through commit/rollback settlement. */
export function createWorkloadExecutor(
  capacities: Partial<Record<DatabaseWorkload, number>>,
) {
  const active = new Map<DatabaseWorkload, number>();
  for (const capacity of Object.values(capacities))
    if (!Number.isSafeInteger(capacity) || capacity < 0)
      throw createAppError('VALIDATION', 'Invalid database workload capacity');
  const acquire = (lane: DatabaseWorkload) => {
    const count = active.get(lane) ?? 0;
    if (count >= (capacities[lane] ?? 0))
      throw createAppError('INFRASTRUCTURE', 'Database capacity unavailable');
    active.set(lane, count + 1);
    return () => active.set(lane, (active.get(lane) ?? 1) - 1);
  };
  const invoke = <T>(lane: DatabaseWorkload, work: () => T): T => {
    const release = acquire(lane);
    try {
      const result = work();
      if (result instanceof Promise) return result.finally(release) as T;
      release();
      return result;
    } catch (error) {
      release();
      throw error;
    }
  };
  return {
    invoke,
    run: async <T>(
      lane: DatabaseWorkload,
      work: () => Promise<T>,
    ): Promise<T> => invoke(lane, work),
  };
}

/** Bind an owning adapter once. Transaction children retain that one slot. */
export function workloadDatabase<T extends object>(
  database: T,
  executor: ReturnType<typeof createWorkloadExecutor>,
  lane: DatabaseWorkload,
): T {
  const constructors = new Set([
    'select',
    'selectDistinct',
    'selectDistinctOn',
    'insert',
    'update',
    'delete',
    '$with',
    'with',
    'from',
    'leftJoin',
    'innerJoin',
    'rightJoin',
    'fullJoin',
    'where',
    'groupBy',
    'having',
    'orderBy',
    'limit',
    'offset',
    'for',
    'union',
    'unionAll',
    'intersect',
    'intersectAll',
    'except',
    'exceptAll',
    'values',
    'onConflictDoNothing',
    'onConflictDoUpdate',
    'returning',
    'set',
    '$dynamic',
    'prepare',
    'findMany',
    'findFirst',
    'as',
    'toSQL',
    'getSQL',
    'rollback',
  ]);
  const forbidden = new Set([
    '$client',
    'session',
    'client',
    'dialect',
    '_',
    'reserve',
    'setTransaction',
  ]);
  type Lease = {
    active: boolean;
    pending: Set<Promise<unknown>>;
    failures: unknown[];
  };
  const track = <R>(lease: Lease, work: Promise<R>): Promise<R> => {
    lease.pending.add(work);
    void work.then(
      () => lease.pending.delete(work),
      (error) => {
        lease.pending.delete(work);
        lease.failures.push(error);
      },
    );
    return work;
  };
  const bindMethod = (
    object: object,
    key: string | symbol,
    value: (...args: unknown[]) => unknown,
    lease?: Lease,
  ) => {
    const run = <R>(work: () => Promise<R>) =>
      lease ? track(lease, work()) : executor.run(lane, work);
    if (key === 'transaction') {
      if (lease)
        throw createAppError(
          'INFRASTRUCTURE',
          'Nested database transaction unavailable',
        );
      return (work: (tx: object) => Promise<unknown>, ...options: unknown[]) =>
        run(async () => {
          const child: Lease = {
            active: true,
            pending: new Set(),
            failures: [],
          };
          try {
            return await Reflect.apply(value, object, [
              async (tx: object) => {
                let result: unknown;
                try {
                  result = await work(wrap(tx, child));
                } finally {
                  child.active = false;
                  await Promise.allSettled([...child.pending]);
                }
                if (child.failures.length) throw child.failures[0];
                return result;
              },
              ...options,
            ]);
          } finally {
            child.active = false;
          }
        });
    }
    if (key === 'execute')
      return (...args: unknown[]) =>
        run(async () => Reflect.apply(value, object, args));
    if (key === 'then' || key === 'catch' || key === 'finally')
      return (...args: unknown[]) =>
        Reflect.apply(
          Reflect.get(Promise.prototype, key),
          run(() => Promise.resolve(object)),
          args,
        );
    if (typeof key !== 'string' || !constructors.has(key))
      throw createAppError('INFRASTRUCTURE', 'Unsupported database operation');
    return (...args: unknown[]) => {
      const build = () => Reflect.apply(value, object, args) as unknown;
      const result = lease ? build() : executor.invoke(lane, build);
      if (key === 'getSQL' || key === 'toSQL') return result;
      if (result instanceof Promise)
        return lease ? track(lease, result) : result;
      return result !== null && typeof result === 'object'
        ? wrap(result, lease)
        : result;
    };
  };
  const readMember = (
    object: object,
    key: string | symbol,
    lease?: Lease,
  ): unknown => {
    if (typeof key === 'string' && forbidden.has(key))
      throw createAppError(
        'INFRASTRUCTURE',
        'Database driver access unavailable',
      );
    if (lease && !lease.active)
      throw createAppError(
        'INFRASTRUCTURE',
        'Database transaction has settled',
      );
    const value = Reflect.get(object, key, object);
    if (typeof value !== 'function')
      return value !== null && typeof value === 'object'
        ? wrap(value, lease)
        : value;
    const bound = bindMethod(object, key, value, lease);
    return (...args: unknown[]) => {
      if (lease && !lease.active)
        throw createAppError(
          'INFRASTRUCTURE',
          'Database transaction has settled',
        );
      return Reflect.apply(bound, undefined, args);
    };
  };
  const refuseMutation = () => {
    throw createAppError(
      'INFRASTRUCTURE',
      'Database surface mutation unavailable',
    );
  };
  const wrap = (target: object, lease?: Lease): object =>
    new Proxy(target, {
      defineProperty: refuseMutation,
      set: refuseMutation,
      deleteProperty: refuseMutation,
      setPrototypeOf: refuseMutation,
      preventExtensions: refuseMutation,
      getPrototypeOf(object) {
        if (!Reflect.isExtensible(object))
          throw createAppError(
            'INFRASTRUCTURE',
            'Database prototype unavailable',
          );
        return null;
      },
      get: (object, key) => readMember(object, key, lease),
      getOwnPropertyDescriptor(object, key) {
        const value = readMember(object, key, lease);
        const descriptor = Reflect.getOwnPropertyDescriptor(object, key);
        if (!descriptor) return undefined;
        if (
          !descriptor.configurable &&
          descriptor.writable === false &&
          descriptor.value !== value
        )
          throw createAppError(
            'INFRASTRUCTURE',
            'Unsupported database reflection',
          );
        if ('value' in descriptor) return { ...descriptor, value };
        return {
          configurable: descriptor.configurable ?? false,
          enumerable: descriptor.enumerable ?? false,
          get: () => readMember(object, key, lease),
        };
      },
    });
  return wrap(database) as T;
}

export type DatabaseWorkloadProfile =
  'web' | 'realtime' | 'reconciliation' | 'projection';
/** Physical pool ceilings include every allocated workload, never hidden extra pools. */
export function workloadCapacities(
  profile: DatabaseWorkloadProfile,
  poolSize: number,
) {
  if (!Number.isSafeInteger(poolSize) || poolSize < 1)
    throw createAppError('VALIDATION', 'Invalid database pool capacity');
  const requested: Partial<Record<DatabaseWorkload, number>> =
    profile === 'projection'
      ? { projection: 2, headers: 1, relay: 1 }
      : profile === 'web'
        ? { control: 2, competitive: 4, social: 3, search: 1, admission: 2 }
        : {
            control: 1,
            renewal: 2,
            admission: 1,
            ...(profile === 'reconciliation'
              ? { projection: 2, headers: 1, relay: 1 }
              : {}),
          };
  let remaining = poolSize;
  const capacities: Partial<Record<DatabaseWorkload, number>> = {};
  for (const [lane, ceiling] of Object.entries(requested)) {
    capacities[lane as DatabaseWorkload] = Math.min(remaining, ceiling);
    remaining -= capacities[lane as DatabaseWorkload]!;
  }
  return capacities;
}
