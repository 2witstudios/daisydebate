import { createSubscriptionRegistry } from './registry';
import type { OutboxRow } from '@daisy/db';

export const topic = `room:${'b'.repeat(24)}`;
export const row = (seq: number): OutboxRow => ({
  txid: '1',
  seq: BigInt(seq),
  topic,
  kind: 'room.changed',
  version: seq,
  payload: { kind: 'room.changed', ids: ['b'.repeat(24)], entityVersion: seq },
  createdAt: '2026-10-09T00:00:00.000Z',
});
export function fixture(
  overrides: Partial<Parameters<typeof createSubscriptionRegistry>[0]> = {},
) {
  let now = 0;
  const sent: import('@daisy/protocol').ServerMessage[] = [];
  const attached = new Set<string>();
  const socket = {
    send: (frame: import('@daisy/protocol').ServerMessage) => {
      sent.push(frame);
    },
    subscribe: (value: string) => {
      attached.add(value);
    },
    unsubscribe: (value: string) => {
      attached.delete(value);
    },
    close: () => {},
  };
  const registry = createSubscriptionRegistry({
    now: () => now,
    lifetimeMs: 60_000,
    ringLimit: 2,
    maxSubscriptions: 64,
    authorize: async () => ({ revision: '1', validUntil: now + 60_000 }),
    readCatchup: async () => ({ rows: [], resync: false }),
    readRetentionBoundary: async () => ({ txid: '0', seq: 0n }),
    publish: (_topic, frame) => {
      sent.push(frame);
    },
    ...overrides,
  });
  const connection = registry.add(socket, {
    actorId: 'a'.repeat(24),
    sessionId: 'c'.repeat(24),
    userId: 'd'.repeat(24),
  });
  return {
    registry,
    connection,
    socket,
    sent,
    attached,
    setNow: (value: number) => {
      now = value;
    },
  };
}
