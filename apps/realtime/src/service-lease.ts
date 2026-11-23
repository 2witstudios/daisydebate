import type { Waits } from '@daisy/clock';
import type { OutboxPosition } from '@daisy/db/outbox';
import { repeatEvery } from '@daisy/worker';

/** How often the realtime liveness lease renews. */
const SERVICE_LEASE_RENEW_MS = 1000;

/**
 * A liveness heartbeat, not an exclusive lease: every instance renews its own
 * row. Cursor is sampled from the actual synchronous outbox-delivery boundary
 * each renewal.
 */
export function startRealtimeServiceLease(input: {
  readonly instanceId: string;
  readonly renew: (lease: {
    readonly instanceId: string;
    readonly role: 'realtime';
    readonly deliveredThrough: OutboxPosition;
  }) => Promise<void>;
  readonly deliveredThrough: () => OutboxPosition;
  /** The renewal's own failure; the log keeps the code, never the content. */
  readonly failed: (error: unknown) => void;
  readonly waits: Waits;
}) {
  // A renewal never overlaps another, and a failure sink that throws never
  // stops the heartbeat (ISSUE-789): repeatEvery contains both.
  const worker = repeatEvery({
    waits: input.waits,
    everyMs: SERVICE_LEASE_RENEW_MS,
    runOnStart: true,
    // A cursor read that throws synchronously is a failed renewal too.
    run: async () =>
      input.renew({
        instanceId: input.instanceId,
        role: 'realtime',
        deliveredThrough: input.deliveredThrough(),
      }),
    failed: input.failed,
  });
  return { stop: () => worker.stop() };
}
