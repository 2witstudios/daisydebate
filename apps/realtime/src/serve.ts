import type { RealtimeApp } from './app';
import { createRealtimeServer } from './server';
import {
  startOutboxDrain,
  type IntervalTimers,
  type OutboxDrainControl,
  type OutboxRowsSink,
} from './outbox-drain';

/**
 * Wires startup order (ADR 0032 §2) around `Bun.serve`: `startOutboxDrain`
 * is awaited first (LISTEN, then the high-water mark), and only then does
 * `Bun.serve` accept sockets, with the drain loop's own cursor wired into
 * readiness as `outbox` (ADR 0031/0032's "delivery lag exposed for
 * readiness"). Shared by `start.ts` (the process edge) and the integration
 * suite's own real Bun.serve boot, so the two never drift apart.
 */
export async function serveRealtime({
  resources,
  port,
  hostname = '0.0.0.0',
  sink,
  pollIntervalMs,
  timers,
  onQuery,
}: {
  readonly resources: RealtimeApp;
  readonly port: number;
  readonly hostname?: string;
  readonly sink: OutboxRowsSink;
  readonly pollIntervalMs?: number;
  readonly timers?: IntervalTimers;
  readonly onQuery?: () => void;
}): Promise<{
  readonly server: ReturnType<typeof Bun.serve>;
  readonly drain: OutboxDrainControl;
}> {
  const drain = await startOutboxDrain({
    database: resources.database,
    sink,
    ...(pollIntervalMs === undefined ? {} : { pollIntervalMs }),
    ...(timers === undefined ? {} : { timers }),
    ...(onQuery === undefined ? {} : { onQuery }),
  });
  const { fetch, websocket } = createRealtimeServer({
    resources: {
      ...resources,
      outbox: {
        cursor: drain.cursor,
        highWaterMark: resources.database.readOutboxHighWaterMark,
      },
    },
  });
  const server = Bun.serve({ hostname, port, fetch, websocket });
  return { server, drain };
}
