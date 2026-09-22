import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  buildDebateChatTopic,
  buildDebatePresenceTopic,
  buildDebateTopic,
  buildStandingsTopic,
  buildUserInboxTopic,
  outboxPayloadSchema,
  parseTopic,
  publicDoorbellTopicFamilies,
  subscribeAuthorizationTable,
} from './realtime';

setupRitewayBun();

const id = 'k2v9x0f4m8q3w1z7c5n6b4d2';

describe('topic grammar', () => {
  test('builds every topic shape and parses it back', () => {
    assert({
      given: 'a debate id',
      should: 'build the bare debate topic',
      actual: buildDebateTopic(id),
      expected: `debate:${id}`,
    });
    assert({
      given: 'the built topics for every family',
      should: 'parse back to the matching family and ids',
      actual: [
        parseTopic(buildDebateTopic(id)),
        parseTopic(buildDebatePresenceTopic(id)),
        parseTopic(buildDebateChatTopic(id)),
        parseTopic(buildUserInboxTopic(id)),
        parseTopic(buildStandingsTopic('2026')),
      ],
      expected: [
        { family: 'debate', debateId: id },
        { family: 'debate:presence', debateId: id },
        { family: 'debate:chat', debateId: id },
        { family: 'user:inbox', userId: id },
        { family: 'standings', season: '2026' },
      ],
    });
  });

  test('rejects non-cuid2 segments and unknown shapes', () => {
    const rejected = [
      'debate:not-a-cuid2',
      'debate:0f0e6d1c-2b3a-4455-9a8b-7c6d5e4f3a21',
      `debate:${id}:unknown-suffix`,
      `user:${id}`,
      `user:${id}:outbox`,
      'user:not-a-cuid2:inbox',
      'standings:',
      'season:2026',
      'debate:',
      '',
      `debate:${id}:presence:extra`,
    ];
    assert({
      given: 'topic strings with bad ids or unrecognized shapes',
      should: 'return undefined for every one',
      actual: rejected.map((topic) => parseTopic(topic)),
      expected: rejected.map(() => undefined),
    });
  });

  test('builders throw on a non-cuid2 segment instead of building a bad topic', () => {
    assert({
      given: 'a builder called with a malformed id',
      should: 'throw rather than return an unparseable topic',
      actual: (() => {
        try {
          buildDebateTopic('not-a-cuid2');
          return 'did not throw';
        } catch {
          return 'threw';
        }
      })(),
      expected: 'threw',
    });
  });
});

describe('outbox payload schema', () => {
  test('validates a doorbell payload by kind and version', () => {
    assert({
      given: 'a version 1 doorbell payload naming a known kind',
      should: 'accept it',
      actual: outboxPayloadSchema.safeParse({
        version: 1,
        kind: 'debate.phase-changed',
        ids: [id],
      }).success,
      expected: true,
    });
    assert({
      given: 'a payload with an unknown kind',
      should: 'reject it',
      actual: outboxPayloadSchema.safeParse({
        version: 1,
        kind: 'debate.exploded',
        ids: [id],
      }).success,
      expected: false,
    });
    assert({
      given: 'a payload stamped with a future version',
      should: 'reject it',
      actual: outboxPayloadSchema.safeParse({
        version: 2,
        kind: 'debate.phase-changed',
        ids: [id],
      }).success,
      expected: false,
    });
  });

  test('rejects a public-family doorbell payload carrying anything beyond ids, kind and version', () => {
    assert({
      given:
        'a doorbell-shaped payload for a public family with an extra field',
      should: 'reject it',
      actual: outboxPayloadSchema.safeParse({
        version: 1,
        kind: 'debate.phase-changed',
        ids: [id],
        phase: 'active',
      }).success,
      expected: false,
    });
  });

  test('lets the owner-only inbox family carry a small delta beyond ids, kind and version', () => {
    assert({
      given: 'a notification delta payload for the owner-only inbox family',
      should: 'accept it',
      actual: outboxPayloadSchema.safeParse({
        version: 1,
        kind: 'user.notification-delivered',
        ids: [id],
        notificationType: 'debate.forfeit',
        occurredAt: '2026-01-01T00:00:00.000Z',
      }).success,
      expected: true,
    });
  });

  test('exposes which topic families are doorbell-only', () => {
    assert({
      given: 'the public doorbell topic families',
      should:
        'list debate, debate:presence and standings, and never user:inbox',
      actual: [...publicDoorbellTopicFamilies].sort(),
      expected: ['debate', 'debate:presence', 'standings'].sort(),
    });
  });
});

describe('subscribe authorization table', () => {
  test('is data covering every topic family, refusing anything else', () => {
    assert({
      given: 'the authorization table',
      should: 'have exactly one rule per known topic family',
      actual: Object.keys(subscribeAuthorizationTable).sort(),
      expected: [
        'debate',
        'debate:chat',
        'debate:presence',
        'standings',
        'user:inbox',
      ].sort(),
    });
    assert({
      given: 'the inbox family rule',
      should: 'be owner-only',
      actual: subscribeAuthorizationTable['user:inbox'],
      expected: { kind: 'owner-only' },
    });
    assert({
      given: 'the standings family rule',
      should: 'admit any member',
      actual: subscribeAuthorizationTable.standings,
      expected: { kind: 'any-member' },
    });
    assert({
      given: 'a topic family outside the vocabulary',
      should: 'have no entry, so it is refused by default',
      actual: Object.hasOwn(subscribeAuthorizationTable, 'debate:notes'),
      expected: false,
    });
  });
});
