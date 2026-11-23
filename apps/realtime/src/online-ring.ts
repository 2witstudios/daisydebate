import type { Waits } from '@daisy/clock';
import type { OutboxRow } from '@daisy/db/outbox';
import { repeatEvery } from '@daisy/worker';

/** How often a node looks for a change, so browsers hear within about a second. */
const ONLINE_RING_MS = 1_000;

/** Row kinds that can move someone's status, read from every node's own drain. */
const statusRows = new Set([
  'room.changed',
  'round.phase-changed',
  'actor.presence-preference-changed',
]);

/**
 * The people list's doorbell (ADR 0103). Lease writes move one Redis revision,
 * and room, Round and chosen-status changes arrive as outbox rows on every
 * node, so each node rings its own subscribers at most once a tick. Redis being
 * down costs a ring, never a socket: browsers re-read on their own schedule too.
 */
export function createOnlineRing({
  readRevision,
  ring,
  waits,
}: {
  readonly readRevision: () => Promise<number>;
  readonly ring: () => void;
  readonly waits: Waits;
}) {
  let lastRevision: number | null = null;
  let dirty = false;
  let reading = false;
  const tick = async () => {
    if (reading) return;
    reading = true;
    try {
      const revision = await readRevision();
      if (lastRevision !== null && revision !== lastRevision) dirty = true;
      lastRevision = revision;
    } catch {
      // The Redis adapter logged it; rows still ring below.
    } finally {
      reading = false;
    }
    if (!dirty) return;
    dirty = false;
    ring();
  };
  const ticks = repeatEvery({
    waits,
    everyMs: ONLINE_RING_MS,
    run: tick,
    // A tick contains its own failures; a ring that throws waits for the next.
    failed: () => undefined,
  });
  return {
    /** Notes rows from this node's drain; the next tick rings for them. */
    observe(rows: readonly Pick<OutboxRow, 'kind'>[]) {
      if (rows.some((row) => statusRows.has(row.kind))) dirty = true;
    },
    /** One tick now, for tests. */
    tick,
    /** Stops the ticks and waits for one in flight. */
    stop: () => ticks.stop(),
  };
}
