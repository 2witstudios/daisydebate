import {
  decodeOutboxCursor,
  encodeOutboxCursor,
  type OutboxPosition,
  type OutboxRow,
} from '@daisy/db';
import { outboxPayloadSchema } from '@daisy/protocol';

export type ObservationControl = {
  readonly kind: 'session';
  readonly actorId: string;
  /** Null revokes every session of the actor. */
  readonly sessionId: string | null;
};
const batch = 256;

function control(row: OutboxRow): ObservationControl | null {
  const payload = outboxPayloadSchema.safeParse(row.payload);
  if (!payload.success || payload.data.kind !== 'session.revoked') return null;
  const [actorId, sessionId] = payload.data.ids;
  return { kind: 'session', actorId: actorId!, sessionId: sessionId ?? null };
}

/** One elected metadata relay among eligible workers. It turns durable
 * control rows into expendable fences and advances a token-fenced shared
 * cursor only after publishing. Content progress never waits on it; a lost
 * cursor restarts at the finalized position because current-state reads
 * and permit expiry cover anything it skips.
 */
export function createObservationRelay({
  nextToken,
  cache,
  outbox,
}: {
  readonly nextToken: () => string;
  readonly cache: {
    readonly claim: (token: string) => Promise<boolean>;
    readonly readCursor: () => Promise<string | null>;
    readonly advance: (
      token: string,
      from: string | null,
      to: string,
    ) => Promise<boolean>;
    readonly publish: (control: ObservationControl) => Promise<void>;
  };
  readonly outbox: {
    readonly highWaterMark: () => Promise<OutboxPosition>;
    readonly drain: (
      position: OutboxPosition,
      limit: number,
    ) => Promise<readonly OutboxRow[]>;
  };
}) {
  const token = nextToken();
  let running = false;
  async function cursor() {
    const current = await cache.readCursor();
    if (current !== null) return current;
    const start = encodeOutboxCursor(await outbox.highWaterMark());
    return (await cache.advance(token, null, start)) ? start : null;
  }
  return {
    async tick(): Promise<'follower' | 'lost' | 'idle' | 'progress'> {
      if (running) return 'idle';
      running = true;
      try {
        if (!(await cache.claim(token))) return 'follower';
        const from = await cursor();
        if (from === null) return 'lost';
        const rows = await outbox.drain(decodeOutboxCursor(from), batch);
        const last = rows.at(-1);
        if (!last) return 'idle';
        for (const row of rows) {
          const fence = control(row);
          if (fence) await cache.publish(fence);
        }
        return (await cache.advance(token, from, encodeOutboxCursor(last)))
          ? 'progress'
          : 'lost';
      } finally {
        running = false;
      }
    },
  };
}
