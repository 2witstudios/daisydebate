import {
  observationBaseKey,
  observationFrameBytes,
  type ObservationBase,
} from '@daisy/protocol';
import type { ObservationPermit } from './observation-permit';
export type ObservationSnapshot = {
  readonly base: ObservationBase;
  readonly contentRevision: number;
  readonly purgeGeneration: number;
  readonly body: string;
};
type Recipient = {
  readonly permit: ObservationPermit;
  readonly send: (snapshot: ObservationSnapshot) => unknown;
  delivered: number;
  active: boolean;
};
type Entry = {
  readonly base: ObservationBase;
  readonly recipients: Set<Recipient>;
  snapshot: ObservationSnapshot | null;
  bytes: number;
  dirty: boolean;
};
/** Expendable node cache. Content updates do Redis work per key, then only
 * synchronous local permission gates and sends per recipient.
 */
export function createObservationNode({
  nodeIncarnation,
  now,
  yieldWork,
  cache,
}: {
  readonly nodeIncarnation: string;
  readonly now: () => number;
  readonly yieldWork: () => Promise<void>;
  readonly cache: {
    readonly demand: (base: ObservationBase) => Promise<void>;
    readonly read: (
      base: ObservationBase,
    ) => Promise<ObservationSnapshot | null>;
  };
}) {
  const entries = new Map<string, Entry>();
  const jobs = new Map<Entry, Promise<void>>();
  let bindings = 0,
    encodedBytes = 0,
    closed = false,
    repairing = false;
  function enqueue(entry: Entry) {
    const key = observationBaseKey(entry.base);
    if (jobs.has(entry) || closed || jobs.size >= 1024) return;
    const work = Promise.resolve()
      .then(async () => {
        do {
          entry.dirty = false;
          const snapshot = entry.snapshot;
          if (!snapshot) break;
          let sends = 0,
            sliceStarted = now();
          for (const recipient of entry.recipients) {
            if (closed || entries.get(key) !== entry) return;
            if (sends >= 128 || now() - sliceStarted >= 2) {
              await yieldWork();
              sends = 0;
              sliceStarted = now();
            }
            // Final application enqueue is synchronous after every await.
            if (
              closed ||
              entries.get(key) !== entry ||
              snapshot.purgeGeneration !== entry.snapshot?.purgeGeneration
            )
              return;
            if (
              !recipient.active ||
              recipient.delivered >= snapshot.contentRevision ||
              !recipient.permit.allows(
                snapshot.base,
                snapshot.contentRevision,
                nodeIncarnation,
              )
            )
              continue;
            recipient.send(snapshot);
            recipient.delivered = snapshot.contentRevision;
            sends++;
          }
        } while (entry.dirty && !closed);
      })
      .catch(() => {
        /* Transport composition sheds failed recipients. */
      })
      .finally(() => {
        jobs.delete(entry);
        const current = entries.get(key);
        if (current?.dirty && !closed) enqueue(current);
      });
    jobs.set(entry, work);
  }
  const api = {
    observe(
      base: ObservationBase,
      permit: ObservationPermit,
      send: Recipient['send'],
    ) {
      if (closed || bindings >= 5000)
        throw new Error('Observation binding capacity exceeded');
      const key = observationBaseKey(base);
      let entry = entries.get(key);
      if (!entry) {
        if (jobs.size >= 1024)
          throw new Error('Observation pending capacity exceeded');
        if (entries.size >= 1024)
          throw new Error('Observation key capacity exceeded');
        entry = {
          base,
          recipients: new Set(),
          snapshot: null,
          bytes: 0,
          dirty: false,
        };
        entries.set(key, entry);
      }
      const current = entry,
        recipient: Recipient = { permit, send, delivered: -1, active: true };
      current.recipients.add(recipient);
      bindings++;
      current.dirty = true;
      enqueue(current);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        recipient.active = false;
        current.recipients.delete(recipient);
        bindings--;
        if (!current.recipients.size && entries.get(key) === current) {
          entries.delete(key);
          encodedBytes -= current.bytes;
        }
      };
    },
    accept(snapshot: ObservationSnapshot) {
      if (closed) return false;
      const key = observationBaseKey(snapshot.base),
        entry = entries.get(key);
      if (!entry) return false;
      if (
        snapshot.purgeGeneration >
        (entry.snapshot?.purgeGeneration ?? snapshot.purgeGeneration)
      ) {
        for (const scoped of entries.values())
          if (
            scoped.base.resource.kind === snapshot.base.resource.kind &&
            scoped.base.resource.id === snapshot.base.resource.id
          )
            for (const recipient of scoped.recipients)
              recipient.permit.uncertain();
      }
      if (
        entry.snapshot &&
        (snapshot.contentRevision <= entry.snapshot.contentRevision ||
          snapshot.purgeGeneration < entry.snapshot.purgeGeneration)
      )
        return false;
      const bytes = Buffer.byteLength(snapshot.body);
      if (
        bytes > observationFrameBytes ||
        encodedBytes - entry.bytes + bytes > 64 * 1024 * 1024
      )
        return false;
      encodedBytes += bytes - entry.bytes;
      entry.bytes = bytes;
      entry.snapshot = snapshot;
      entry.dirty = true;
      enqueue(entry);
      return true;
    },
    async repair() {
      if (closed || repairing) return;
      repairing = true;
      try {
        let count = 0;
        for (const [key, entry] of entries) {
          if (closed) return;
          await cache.demand(entry.base);
          const snapshot = await cache.read(entry.base);
          if (closed || entries.get(key) !== entry) continue;
          if (snapshot) api.accept(snapshot);
          entry.dirty = true;
          enqueue(entry);
          if (++count % 128 === 0) await yieldWork();
        }
      } finally {
        repairing = false;
      }
    },
    invalidate(dependencyKey?: string) {
      for (const entry of entries.values())
        for (const recipient of entry.recipients)
          recipient.permit.invalidate(dependencyKey);
    },
    async settled() {
      while (jobs.size) await Promise.allSettled([...jobs.values()]);
    },
    close() {
      if (closed) return;
      closed = true;
      api.invalidate();
      entries.clear();
      encodedBytes = 0;
      bindings = 0;
    },
    stats: () => ({
      keys: entries.size,
      bindings,
      encodedBytes,
      pendingKeys: jobs.size,
    }),
  };
  return api;
}
