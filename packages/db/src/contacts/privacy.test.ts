import { assert, setupRitewayBun, test } from 'riteway/bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { fakeSql } from '../index.test-support';
import { contactsPrivacyAdopter } from './privacy';
setupRitewayBun();

const actorId = 'a'.repeat(24),
  peerId = 'b'.repeat(24),
  subject = { actorId, userId: 'u'.repeat(24) },
  now = '2026-10-09T18:00:00.000Z';

test('Contacts exports only the subject’s own side of each pair, request and decline', async () => {
  const date = new Date(now);
  const { client, queries } = fakeSql([
    [
      {
        low_actor_id: actorId,
        high_actor_id: peerId,
        revision: 1,
        low_blocks_high: true,
        high_blocks_low: true,
      },
      {
        low_actor_id: '0'.repeat(24),
        high_actor_id: actorId,
        revision: 2n,
        low_blocks_high: true,
        high_blocks_low: false,
      },
    ],
    [],
    [{ actor_id: actorId, request_id: 'q'.repeat(24), created_at: date }],
    [{ decliner_actor_id: actorId, requester_actor_id: peerId }],
  ]);
  const result = await contactsPrivacyAdopter.export(
    drizzle({ client }),
    subject,
  );
  assert({
    given: 'pairs blocked both ways, the subject’s request and decline',
    should:
      'export each pair with only the subject’s own block direction, and only the requests and declines the subject made',
    actual: [
      result.contact_pairs,
      result.social_requests,
      result.social_request_declines,
      queries
        .slice(2)
        .map((query) => query.query.match(/where ([a-z_]+)=/)?.[1]),
    ],
    expected: [
      [
        {
          low_actor_id: actorId,
          high_actor_id: peerId,
          revision: 1,
          low_blocks_high: true,
        },
        {
          low_actor_id: '0'.repeat(24),
          high_actor_id: actorId,
          revision: 2,
          high_blocks_low: false,
        },
      ],
      [{ actor_id: actorId, request_id: 'q'.repeat(24), created_at: now }],
      [{ decliner_actor_id: actorId, requester_actor_id: peerId }],
      ['actor_id', 'decliner_actor_id'],
    ],
  });
});

test('Contacts erases the subject’s rows, the pairs last, after every consumer’s own', async () => {
  const { client, queries } = fakeSql([[], [], [], []]);
  await contactsPrivacyAdopter.erase(drizzle({ client }), subject, { now });
  assert({
    given: 'an erased subject',
    should:
      'delete declines, requests and Contacts receipts on either side, then the contact pairs',
    actual: [
      contactsPrivacyAdopter.phase,
      queries.map((query) => query.query.match(/delete from ([a-z_]+)/)?.[1]),
      queries.every((query) =>
        query.params.every((value) => value === actorId),
      ),
    ],
    expected: [
      'after-close',
      [
        'social_request_declines',
        'social_requests',
        'contact_commands',
        'contact_pairs',
      ],
      true,
    ],
  });
});
