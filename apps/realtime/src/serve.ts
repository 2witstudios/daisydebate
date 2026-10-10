import { refuseSchemaAlteringRole } from '@daisy/db';
import type { RealtimeApp } from './app';
import { createRealtimeServer } from './server';
import { createRealtimeDelivery } from './delivery';
import type { RealtimeReadingPolicy } from './authorization';
import {
  startOutboxDrain,
  type IntervalTimers,
  type OutboxDrainControl,
  type OutboxRowsSink,
} from './outbox-drain';

function drainOptions(
  pollIntervalMs: number | undefined,
  timers: IntervalTimers | undefined,
  onQuery: (() => void) | undefined,
  onListenWake: (() => void) | undefined,
) {
  return {
    ...(pollIntervalMs === undefined ? {} : { pollIntervalMs }),
    ...(timers === undefined ? {} : { timers }),
    ...(onQuery === undefined ? {} : { onQuery }),
    ...(onListenWake === undefined ? {} : { onListenWake }),
  };
}

const listenerTls = (tls: Bun.TLSOptions | undefined) =>
  tls === undefined ? {} : { tls };

/**
 * Wires startup order (ADR 0032 §2) around `Bun.serve`: production first
 * refuses a schema-altering role (ISSUE-101), then `startOutboxDrain` is
 * awaited (LISTEN, then the high-water mark), and only then does
 * `Bun.serve` accept sockets, with the drain loop's own cursor wired into
 * readiness as `outbox` (ADR 0031/0032's "delivery lag exposed for
 * readiness"). Shared by `start.ts` (the process edge) and the integration
 * suite's own real Bun.serve boot, so the two never drift apart.
 */
export async function serveRealtime({
  resources,
  port,
  hostname = '0.0.0.0',
  tls,
  sink,
  pollIntervalMs,
  timers,
  onQuery,
  onListenWake,
  serve = Bun.serve,
  now = () => performance.now(),
  readingPolicy,
  trustedProxies = [],
}: {
  readonly resources: RealtimeApp;
  readonly port: number;
  readonly hostname?: string;
  readonly tls?: Bun.TLSOptions;
  readonly sink?: OutboxRowsSink;
  readonly now?: () => number;
  readonly readingPolicy?: RealtimeReadingPolicy;
  readonly trustedProxies?: readonly string[];
  readonly pollIntervalMs?: number;
  readonly timers?: IntervalTimers;
  readonly onQuery?: () => void;
  /** Test seam only (RT-2.3b-f1 criterion 2): observes a reconnect independent of database content or other listeners' traffic. */
  readonly onListenWake?: () => void;
  /** Test seam only (RT-2.3b review finding 2): proves sockets are never accepted before `startOutboxDrain` resolves. */
  readonly serve?: typeof Bun.serve;
}): Promise<{
  readonly server: ReturnType<typeof Bun.serve>;
  readonly drain: OutboxDrainControl;
  readonly delivery: ReturnType<typeof createRealtimeDelivery>;
  readonly close: () => Promise<void>;
}> {
  // Production refuses a DATABASE_URL role that could create or alter schema
  // objects before LISTEN or any socket is accepted (ISSUE-101).
  await refuseSchemaAlteringRole(resources, 'daisy_realtime');
  let server: ReturnType<typeof Bun.serve> | undefined;
  const delivery = createRealtimeDelivery({
    resources,
    now,
    ...(readingPolicy ? { readingPolicy } : {}),
    publish: (topic, frame) => {
      if (!server || server.publish(topic, JSON.stringify(frame)) <= 0)
        throw new Error('Realtime recipient unavailable');
    },
  });
  const drain = await startOutboxDrain({
    database: resources.database,
    sink: (rows) => {
      delivery.registry.sink(rows);
      sink?.(rows);
    },
    logger: resources.logger,
    ...drainOptions(pollIntervalMs, timers, onQuery, onListenWake),
  });
  delivery.registry.seed(drain.cursor());
  const { fetch, websocket } = createRealtimeServer({
    resources: {
      ...resources,
      outbox: {
        cursor: drain.cursor,
        highWaterMark: resources.database.readOutboxHighWaterMark,
      },
    },
    allowedOrigins: resources.transport?.allowedOrigins ?? [],
    trustedProxies,
    admission: delivery.admission,
    socketDependencies: {
      registry: delivery.registry,
      authenticate: delivery.authenticate,
      validatePrincipal: delivery.validatePrincipal,
      now,
    },
  });
  try {
    server = serve({
      hostname,
      port,
      fetch,
      websocket,
      ...listenerTls(tls),
    });
  } catch (error) {
    await drain.stop();
    throw error;
  }
  // Scheduling is transport tuning inside ADR0031's accepted60s bound.
  // Every send independently enforces elapsed check-start expiry.
  const scheduler = timers ?? {
    setInterval: (callback: () => void, ms: number) =>
      setInterval(callback, ms),
    clearInterval: (handle: ReturnType<typeof setInterval>) =>
      clearInterval(handle),
  };
  let validation: Promise<void> | undefined;
  let closed = false;
  const validationTimer = scheduler.setInterval(() => {
    if (closed || validation) return;
    validation = delivery.registry
      .revalidate(delivery.validatePrincipal)
      .catch(() => {
        delivery.registry.closeAll();
      })
      .finally(() => {
        validation = undefined;
      });
  }, 50_000);
  return {
    server,
    drain,
    delivery,
    async close() {
      if (closed) return;
      closed = true;
      scheduler.clearInterval(validationTimer);
      delivery.registry.closeAll();
      await server?.stop();
      await drain.stop();
      await validation;
      await delivery.registry.settled();
    },
  };
}
