import type { OutboxPosition, OutboxRow } from '@daisy/db';

/**
 * Hands drained rows to whatever consumes them; RT-2.3c wires the real
 * fan-out to subscribed sockets. This leaf stops at the seam.
 */
export type OutboxRowsSink = (
  rows: readonly OutboxRow[],
) => void | Promise<void>;

const MAX_DRAIN_LIMIT = 500;

export type OutboxDrainDeps = {
  /** `createDatabase()`'s bound drain read (RT-2.3b, `@daisy/db`'s `outboxOperations`). */
  readonly drainOutbox: (
    cursor: OutboxPosition,
    limit?: number,
  ) => Promise<readonly OutboxRow[]>;
  readonly sink: OutboxRowsSink;
  readonly initialCursor: OutboxPosition;
  /** Test seam only: counts range queries without altering behavior. */
  readonly onQuery?: (() => void) | undefined;
};

export type OutboxDrainLoop = {
  /** A NOTIFY wakeup: sets the dirty flag and runs a pass if idle (ADR 0032 §3). */
  readonly wake: () => void;
  /** The 1 s poll wakeup: the correctness mechanism, never a fallback. */
  readonly poll: () => void;
  readonly cursor: () => OutboxPosition;
};

/**
 * One coalesced drain loop, never concurrent with itself (ADR 0032 §3): a
 * wakeup (NOTIFY or the 1 s poll) clears the dirty flag before each pass,
 * reads ordered ranges of up to 500 rows until a range comes back short,
 * and fans each range out to the sink before moving the cursor. A wakeup
 * that arrives while a pass is running only sets the flag again, so the
 * loop reruns once as soon as the current pass ends instead of running one
 * query per event. Advancing the cursor and calling the sink happen with no
 * `await` between them within a single range, so a range is never counted
 * as delivered before its rows reach the sink.
 */
export function createOutboxDrainLoop({
  drainOutbox,
  sink,
  initialCursor,
  onQuery,
}: OutboxDrainDeps): OutboxDrainLoop {
  let cursor = initialCursor;
  let dirty = false;
  let running = false;

  async function runPass(): Promise<void> {
    if (running) return;
    running = true;
    try {
      do {
        dirty = false;
        let rows: readonly OutboxRow[];
        do {
          onQuery?.();
          rows = await drainOutbox(cursor, MAX_DRAIN_LIMIT);
          if (rows.length > 0) {
            const last = rows[rows.length - 1];
            if (last) cursor = { txid: last.txid, seq: last.seq };
            await sink(rows);
          }
        } while (rows.length === MAX_DRAIN_LIMIT);
      } while (dirty);
    } finally {
      running = false;
    }
  }

  function trigger(): void {
    dirty = true;
    if (!running) void runPass();
  }

  return {
    wake: trigger,
    poll: trigger,
    cursor: () => cursor,
  };
}

export type IntervalTimers = {
  readonly setInterval: (
    callback: () => void,
    ms: number,
  ) => ReturnType<typeof setInterval>;
  readonly clearInterval: (handle: ReturnType<typeof setInterval>) => void;
};
const systemIntervalTimers: IntervalTimers = {
  setInterval: (callback, ms) => setInterval(callback, ms),
  clearInterval: (handle) => clearInterval(handle),
};

/** The correctness mechanism's period (ADR 0032 §3): never a fallback, never disabled. */
const DRAIN_POLL_INTERVAL_MS = 1_000;

type OutboxListenSubscription = {
  readonly unlisten: () => Promise<void>;
};

export type OutboxDrainDatabase = {
  readonly listenOutbox: (handlers: {
    readonly onNotify: (position: string) => void;
    readonly onListen: () => void;
  }) => Promise<OutboxListenSubscription>;
  readonly readOutboxHighWaterMark: () => Promise<OutboxPosition>;
  readonly drainOutbox: (
    cursor: OutboxPosition,
    limit?: number,
  ) => Promise<readonly OutboxRow[]>;
};

export type OutboxDrainControl = {
  readonly cursor: () => OutboxPosition;
  readonly stop: () => Promise<void>;
};

/**
 * Instance startup order (ADR 0032 §2): `LISTEN outbox` first, awaited to
 * its PostgreSQL acknowledgement; only then the high-water mark read seeds
 * the drain loop's cursor. A notification or reconnect (`onListen`, fired
 * again by Bun SQL after every reconnect) that lands before the loop exists
 * is buffered as a pending wake rather than lost, then replayed once the
 * loop is ready. The caller accepts sockets only after this resolves.
 */
export async function startOutboxDrain({
  database,
  sink,
  pollIntervalMs = DRAIN_POLL_INTERVAL_MS,
  timers = systemIntervalTimers,
  onQuery,
}: {
  readonly database: OutboxDrainDatabase;
  readonly sink: OutboxRowsSink;
  /** Test seam only; production never overrides the ADR-fixed period. */
  readonly pollIntervalMs?: number;
  readonly timers?: IntervalTimers;
  readonly onQuery?: () => void;
}): Promise<OutboxDrainControl> {
  const state: { loop?: OutboxDrainLoop; pendingWake: boolean } = {
    pendingWake: false,
  };
  const wake = () => {
    if (state.loop) state.loop.wake();
    else state.pendingWake = true;
  };

  const subscription = await database.listenOutbox({
    onNotify: () => wake(),
    onListen: () => wake(),
  });

  const initialCursor = await database.readOutboxHighWaterMark();
  const loop = createOutboxDrainLoop({
    drainOutbox: database.drainOutbox,
    sink,
    initialCursor,
    onQuery,
  });
  state.loop = loop;
  if (state.pendingWake) loop.wake();

  const interval = timers.setInterval(() => loop.poll(), pollIntervalMs);

  return {
    cursor: () => loop.cursor(),
    async stop() {
      timers.clearInterval(interval);
      await subscription.unlisten();
    },
  };
}
