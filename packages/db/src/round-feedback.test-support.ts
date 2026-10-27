import type { BoundedTransaction } from './bounded-transaction';

/** A query builder chain that resolves to `result` whichever methods it is called with. */
const chain = (result: unknown): unknown =>
  new Proxy(() => undefined, {
    get: (_target, key) =>
      key === 'then'
        ? (ok: (value: unknown) => void, no: (error: unknown) => void) =>
            Promise.resolve(result).then(ok, no)
        : () => chain(result),
  });

/** A transaction answering each statement, in order, from `answers`. */
export const scripted = (answers: unknown[]) => {
  const queue = [...answers];
  const next = () => queue.shift();
  const tx = {
    execute: async () => next(),
    select: () => chain(next()),
    insert: () => chain(next()),
    update: () => chain(next()),
  };
  const run: BoundedTransaction = (work) =>
    work(tx as never, new AbortController().signal, {} as never);
  return { run, left: () => queue.length };
};
