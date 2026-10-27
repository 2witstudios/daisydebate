import type { OutboxRow } from '@daisy/db/outbox';

/** What a realtime instance still owes its subscribers, for readiness. */
export type DeliveryBacklog = {
  /** Rows waiting or running. */
  readonly retained: number;
  /** Rows whose delivery has started and not yet settled. */
  readonly running: number;
  /** Topics with at least one retained row. */
  readonly topics: number;
  /** Wall-clock age of the oldest retained row's publication, 0 when idle. */
  readonly oldestAgeMs: number;
};

type TopicQueue = {
  readonly rows: OutboxRow[];
  running: OutboxRow | undefined;
};

/**
 * Bounded, isolated outbox delivery (RT-2.3c-arch1). Rows of one topic
 * deliver one at a time in order; at most `maxRunningTopics` topics run at
 * once and ready topics take turns after each row, so a slow authorization on
 * one topic never stalls another. Retained work is counted, never an open
 * promise chain: a topic past `maxPerTopic`, or any arrival past
 * `maxRetained`, drops that topic's waiting rows and reports `overflow`
 * synchronously so its subscribers resync instead of silently missing rows.
 * A running row stays counted until its delivery settles.
 */
export function createDeliveryScheduler({
  maxRunningTopics,
  maxPerTopic,
  maxRetained,
  deliver,
  overflow,
}: {
  readonly maxRunningTopics: number;
  readonly maxPerTopic: number;
  readonly maxRetained: number;
  readonly deliver: (row: OutboxRow) => Promise<void>;
  readonly overflow: (topic: string) => void;
}) {
  const queues = new Map<string, TopicQueue>();
  const ready: string[] = [];
  let retained = 0;
  let running = 0;
  let idle: ReturnType<typeof Promise.withResolvers<void>> | undefined;

  function drop(topic: string, queue: TopicQueue) {
    retained -= queue.rows.length;
    queue.rows.length = 0;
    const position = ready.indexOf(topic);
    if (position >= 0) ready.splice(position, 1);
    if (!queue.running) queues.delete(topic);
  }
  function admit(row: OutboxRow, overflowed: Set<string>) {
    // A topic overflowed in this batch stays resynced: its later rows are moot.
    if (overflowed.has(row.topic)) return;
    const queue = queues.get(row.topic) ?? { rows: [], running: undefined };
    const topicRetained = queue.rows.length + (queue.running ? 1 : 0);
    if (topicRetained >= maxPerTopic || retained >= maxRetained) {
      if (queues.has(row.topic)) drop(row.topic, queue);
      overflowed.add(row.topic);
      overflow(row.topic);
      return;
    }
    queues.set(row.topic, queue);
    queue.rows.push(row);
    retained += 1;
    if (!queue.running && queue.rows.length === 1) ready.push(row.topic);
  }
  function settle(topic: string, queue: TopicQueue) {
    queue.running = undefined;
    running -= 1;
    retained -= 1;
    if (queue.rows.length > 0) ready.push(topic);
    else if (queues.get(topic) === queue) queues.delete(topic);
    pump();
  }
  function pump() {
    while (running < maxRunningTopics && ready.length > 0) {
      const topic = ready.shift()!;
      const queue = queues.get(topic)!;
      const next = queue.rows.shift()!;
      queue.running = next;
      running += 1;
      let delivery: Promise<void>;
      try {
        delivery = deliver(next);
      } catch (error) {
        delivery = Promise.reject(error);
      }
      void delivery.catch(() => {}).finally(() => settle(topic, queue));
    }
    if (retained === 0 && idle) {
      idle.resolve();
      idle = undefined;
    }
  }
  return {
    enqueue(rows: readonly OutboxRow[]) {
      const overflowed = new Set<string>();
      for (const row of rows) admit(row, overflowed);
      pump();
    },
    backlog(wallNowMs: number): DeliveryBacklog {
      let oldest = Number.POSITIVE_INFINITY;
      for (const queue of queues.values()) {
        const first = queue.running ?? queue.rows[0];
        if (first) oldest = Math.min(oldest, Date.parse(first.createdAt));
      }
      return {
        retained,
        running,
        topics: queues.size,
        oldestAgeMs: Number.isFinite(oldest)
          ? Math.max(0, wallNowMs - oldest)
          : 0,
      };
    },
    settled(): Promise<void> {
      if (retained === 0) return Promise.resolve();
      idle ??= Promise.withResolvers<void>();
      return idle.promise;
    },
  };
}
