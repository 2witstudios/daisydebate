import { AsyncLocalStorage } from 'node:async_hooks';

const STORE = Symbol.for('daisy.db.lane-operation');
const host = globalThis as typeof globalThis & {
  [STORE]?: AsyncLocalStorage<string>;
};
/** One per process, not per module copy: Next can bundle a page apart (ISSUE-927). */
const store = (host[STORE] ??= new AsyncLocalStorage<string>());

/** Runs `work` so a lane admitting it can say which operation holds its slot. */
export const withLaneOperation = <T>(operation: string, work: () => T): T =>
  store.run(operation, work);

/** The operation asking for a slot; `unlabelled` shows work no operation wraps. */
export const currentLaneOperation = () => store.getStore() ?? 'unlabelled';

/**
 * The same operations, each running under its own name, for reads whose callers
 * report their own failures, so they need no `instrumented` around them.
 */
export const namedLaneOperations = <T extends object>(operations: T): T =>
  Object.fromEntries(
    Object.entries(operations).map(([name, value]) => [
      name,
      typeof value === 'function'
        ? (...args: unknown[]) =>
            withLaneOperation(name, () => value.apply(operations, args))
        : value,
    ]),
  ) as T;
