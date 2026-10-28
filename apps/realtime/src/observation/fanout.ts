/**
 * The bounded per-node send loop (ADR 0089): it yields the event loop after
 * every 128 sends or 2ms, whichever comes first, so one large audience never
 * starves sockets, commands or timers. `send` performs the synchronous
 * permit check itself, so a binding revoked during a yield is skipped.
 */
export function createFanout({
  now,
  yieldNow = () => new Promise<void>((resolve) => setImmediate(resolve)),
  sendsPerSlice = 128,
  sliceMs = 2,
}: {
  readonly now: () => number;
  readonly yieldNow?: () => Promise<void>;
  readonly sendsPerSlice?: number;
  readonly sliceMs?: number;
}) {
  return async function deliver<T>(
    targets: Iterable<T>,
    send: (target: T) => boolean,
  ): Promise<number> {
    let sent = 0,
      slice = 0,
      started = now();
    for (const target of [...targets]) {
      if (send(target)) sent++;
      if (++slice >= sendsPerSlice || now() - started >= sliceMs) {
        await yieldNow();
        slice = 0;
        started = now();
      }
    }
    return sent;
  };
}
export type Fanout = ReturnType<typeof createFanout>;
