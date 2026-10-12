import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { OutboxPosition, OutboxRow } from '@daisy/db';
import { createObservationRelay } from './observation-relay';
setupRitewayBun();
const actor = 'a'.repeat(24),
  session = 's'.repeat(24);
const row = (seq: number, payload: unknown, kind = 'session.revoked') =>
  ({
    seq: BigInt(seq),
    txid: '10',
    topic: `user:${actor}:inbox`,
    kind,
    version: 1,
    payload,
    createdAt: '2026-10-12T00:00:00.000Z',
  }) satisfies OutboxRow;
function fixture(rows: readonly OutboxRow[]) {
  let cursor: string | null = null,
    owner: string | null = null;
  const published: unknown[] = [],
    drained: string[] = [];
  let tokens = 0;
  const relay = (claims = true) =>
    createObservationRelay({
      nextToken: () => `token${++tokens}`,
      cache: {
        claim: async (token: string) => {
          if (!claims || (owner !== null && owner !== token)) return false;
          owner = token;
          return true;
        },
        readCursor: async () => cursor,
        advance: async (token: string, from: string | null, to: string) => {
          if (owner !== token || cursor !== from) return false;
          cursor = to;
          return true;
        },
        publish: async (control: unknown) => {
          published.push(control);
        },
      },
      outbox: {
        highWaterMark: async (): Promise<OutboxPosition> => ({
          txid: '10',
          seq: 0n,
        }),
        drain: async (position: OutboxPosition, limit: number) => {
          drained.push(`${position.txid}:${position.seq}`);
          return rows
            .filter(
              (item) => item.txid === position.txid && item.seq > position.seq,
            )
            .slice(0, limit);
        },
      },
    });
  return {
    relay,
    published,
    drained,
    cursor: () => cursor,
    steal: () => {
      owner = 'other';
    },
  };
}
test('one elected relay publishes session controls and checkpoints after them', async () => {
  const state = fixture([
    row(1, {
      entityVersion: 1,
      kind: 'session.revoked',
      ids: [actor, session],
    }),
    row(2, { entityVersion: 1, kind: 'channel.changed' }, 'channel.changed'),
    row(3, { entityVersion: 1, kind: 'session.revoked', ids: [actor] }),
  ]);
  const elected = state.relay(),
    follower = state.relay(false);
  await elected.tick();
  await follower.tick();
  const afterFirst = {
    cursor: state.cursor(),
    published: [...state.published],
  };
  await elected.tick();
  assert({
    given:
      'a missing cursor, a session and an account control around a content row, and a non-elected peer',
    should:
      'start at the finalized position, publish only controls once, and advance only after publishing',
    actual: {
      afterFirst,
      drained: state.drained,
      final: state.cursor(),
      published: state.published,
    },
    expected: {
      afterFirst: {
        cursor: '10:3',
        published: [
          { kind: 'session', actorId: actor, sessionId: session },
          { kind: 'session', actorId: actor, sessionId: null },
        ],
      },
      drained: ['10:0', '10:3'],
      final: '10:3',
      published: [
        { kind: 'session', actorId: actor, sessionId: session },
        { kind: 'session', actorId: actor, sessionId: null },
      ],
    },
  });
});
test('a relay that lost its claim cannot checkpoint over its successor', async () => {
  const state = fixture([
    row(1, { entityVersion: 1, kind: 'session.revoked', ids: [actor] }),
  ]);
  const elected = state.relay();
  await elected.tick();
  state.steal();
  const outcome = await elected.tick();
  assert({
    given: 'an expired relay whose claim another process now holds',
    should: 'stop without reading or advancing the shared cursor',
    actual: { outcome, cursor: state.cursor(), drained: state.drained.length },
    expected: { outcome: 'follower', cursor: '10:1', drained: 1 },
  });
});
