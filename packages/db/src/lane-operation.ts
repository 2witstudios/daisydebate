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

const isPlain = (value: object) => {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};
const holdsOperations = (value: object): boolean =>
  isPlain(value) &&
  Object.values(value).some(
    (member) =>
      typeof member === 'function' ||
      (typeof member === 'object' &&
        member !== null &&
        holdsOperations(member)),
  );
const isLazy = (value: object): value is PromiseLike<unknown> =>
  !(value instanceof Promise) &&
  typeof (value as { then?: unknown }).then === 'function';

const named = (
  name: string,
  operation: (...args: never[]) => unknown,
  self: object,
) =>
  Object.assign(
    (...args: never[]) =>
      withLaneOperation(name, () => {
        const result = operation.apply(self, args);
        if (typeof result !== 'object' || result === null) return result;
        // A lazy query starts when awaited: hold the name across that.
        if (isLazy(result)) return withLaneOperation(name, async () => result);
        // A store a factory hands back holds operations of its own.
        return holdsOperations(result)
          ? namedMembers(result, `${name}.`)
          : result;
      }),
    operation,
  );

const namedMembers = <T extends object>(members: T, prefix: string): T =>
  Object.fromEntries(
    Object.entries(members).map(([key, value]) => [
      key,
      typeof value === 'function'
        ? named(`${prefix}${key}`, value, members)
        : typeof value === 'object' && value !== null && holdsOperations(value)
          ? namedMembers(value, `${prefix}${key}.`)
          : value,
    ]),
  ) as T;

/**
 * The same operations, each holding its lane under its own name, nested stores
 * included (`friendStore.withContacts`). An `instrumented` inside one still
 * names its own work; a sync return stays sync.
 */
export const namedLaneOperations = <T extends object>(operations: T): T =>
  namedMembers(operations, '');
