import { assert, setupRitewayBun, test } from 'riteway/bun';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { attachOwnReactions } from './observation-own-reactions';
import type {
  ObservationAuthorityResult,
  ObservationBinding,
} from './observation-contracts';
setupRitewayBun();

const asTx = (tx: object) =>
  tx as unknown as Parameters<typeof attachOwnReactions>[0];

const principal = (actor: string) => ({
  userId: 'u'.repeat(24),
  actorId: actor.repeat(24),
  sessionId: 's'.repeat(24),
});
const binding = (
  kind: 'channel' | 'room',
  actor: string,
  after: number | null,
): ObservationBinding => ({
  principal: principal(actor),
  resource: { kind, id: kind[0]!.repeat(24) },
  window: { after, limit: 20 },
});
const allowed = { status: 'allowed', overlay: null } as unknown as Extract<
  ObservationAuthorityResult,
  { status: 'allowed' }
>;

test('own reactions attach only to allowed channel results, per binding window', async () => {
  const sent: unknown[] = [];
  const tx = {
    execute: async (query: SQL) => {
      sent.push(
        JSON.parse(String(new PgDialect().sqlToQuery(query).params[0])),
      );
      return [
        { binding: 1, messageId: 'm'.repeat(24), reaction: 'like' },
        { binding: 0, messageId: 'n'.repeat(24), reaction: 'heart' },
      ];
    },
  };
  const bindings = [
    binding('channel', 'a', null),
    binding('channel', 'b', 9),
    binding('channel', 'c', null),
    binding('room', 'a', null),
  ];
  const results = await attachOwnReactions(asTx(tx), bindings, [
    allowed,
    allowed,
    { status: 'denied' },
    allowed,
  ]);
  assert({
    given: 'two allowed channel bindings, a denied channel and an allowed Room',
    should:
      'read only the allowed channel windows once and attach each its own reactions',
    actual: {
      sent,
      overlays: results.map((r) =>
        r.status === 'allowed' ? r.overlay : r.status,
      ),
    },
    expected: {
      sent: [
        [
          {
            channel: 'c'.repeat(24),
            actor: 'a'.repeat(24),
            before: null,
            limit: 20,
          },
          {
            channel: 'c'.repeat(24),
            actor: 'b'.repeat(24),
            before: 9,
            limit: 20,
          },
        ],
      ],
      overlays: [
        { ownReactions: [{ messageId: 'n'.repeat(24), reaction: 'heart' }] },
        { ownReactions: [{ messageId: 'm'.repeat(24), reaction: 'like' }] },
        'denied',
        null,
      ],
    },
  });
});

test('no allowed channel binding reads nothing', async () => {
  let calls = 0;
  const tx = {
    execute: async () => {
      calls++;
      return [];
    },
  };
  await attachOwnReactions(asTx(tx), [binding('room', 'a', null)], [allowed]);
  assert({
    given: 'only an allowed Room result',
    should: 'perform no own-reaction read',
    actual: calls,
    expected: 0,
  });
});
