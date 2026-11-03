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
