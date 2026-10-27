import type { OutboxPosition } from '@daisy/db/outbox';

/** Cursor is sampled from the actual synchronous outbox-delivery boundary each renewal. */
export function startRealtimeServiceLease(input: {
  readonly instanceId: string;
  readonly renew: (lease: {
    readonly instanceId: string;
    readonly role: 'realtime';
    readonly deliveredThrough: OutboxPosition;
  }) => Promise<void>;
  readonly deliveredThrough: () => OutboxPosition;
  readonly failed: () => void;
  readonly timers: {
    readonly setInterval: (tick: () => void, ms: number) => unknown;
    readonly clearInterval: (handle: unknown) => void;
  };
}) {
  let stopped = false;
  let work: Promise<void> | null = null;
  const tick = () => {
    if (stopped || work) return work;
    work = input
      .renew({
        instanceId: input.instanceId,
        role: 'realtime',
        deliveredThrough: input.deliveredThrough(),
      })
      .catch(() => input.failed())
      .finally(() => {
        work = null;
      });
    return work;
  };
  const timer = input.timers.setInterval(tick, 1000);
  tick();
  return {
    async stop() {
      stopped = true;
      input.timers.clearInterval(timer);
      await work;
    },
  };
}
