import { expect } from 'bun:test';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  backpressureBounds,
  buildDebateChatTopic,
  buildDebatePresenceTopic,
  buildDebateTopic,
  buildStandingsTopic,
  buildUserInboxTopic,
  cursorSchema,
  heartbeatMs,
  idleTimeout,
  parseTopic,
  reconnectBudgetMs,
  seasonIdSchema,
  topicStringSchema,
} from './realtime';
import { parseOutcome } from './parse-outcome.test-support';

setupRitewayBun();

describe('protocol constants (ADR 0031 §7, §9; ADR 0033 §6)', () => {
  test('names the heartbeat, reconnect budget, idle timeout and backpressure bounds the ADRs fix', () => {
    assert({
      given: 'the exported protocol constants',
      should: 'equal the values ADR 0031 and ADR 0033 fix',
      actual: {
        heartbeatMs,
        reconnectBudgetMs,
        idleTimeout,
        backpressureBounds,
      },
      expected: {
        heartbeatMs: 15_000,
        reconnectBudgetMs: 10_000,
        idleTimeout: 36,
        backpressureBounds: { hardBytes: 1_048_576, softBytes: 262_144 },
      },
    });
  });

  test('satisfies the check-in-grace-covers-reconnect invariant input ADR 0033 §6 fixes', () => {
    assert({
      given: 'heartbeatMs and reconnectBudgetMs',
      should:
        'size a 40 000 ms grace floor: heartbeatMs * 2 + reconnectBudgetMs',
      actual: heartbeatMs * 2 + reconnectBudgetMs,
      expected: 40_000,
    });
  });
});

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
        { family: 'user:inbox', actorId: id },
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
    expect(() => buildDebateTopic('not-a-cuid2')).toThrow(
      'Invalid string: must match pattern',
    );
  });

  test('rejects a season slug with a trailing hyphen', () => {
    assert({
      given: 'a season slug ending in a hyphen',
      should: 'reject it',
      actual: [
        parseOutcome(seasonIdSchema, '2026-'),
        parseOutcome(seasonIdSchema, '2026'),
        parseOutcome(seasonIdSchema, 'fall-2026'),
      ],
      expected: [
        { issues: ['(root)'] },
        { data: '2026' },
        { data: 'fall-2026' },
      ],
    });
  });

  test('bounds the topic string length', () => {
    const oversizedTopic = `standings:${'a'.repeat(200)}`;
    assert({
      given: 'a topic string far longer than any real topic',
      should:
        'fail the length bound alone: the shape refinement never parses an oversized string',
      actual: topicStringSchema
        .safeParse(oversizedTopic)
        .error?.issues.map((issue) => issue.code),
      expected: ['too_big'],
    });
  });
});

describe('the since cursor', () => {
  test('accepts a well-formed txid:seq cursor at the 20-digit bound', () => {
    const twentyDigits = '1'.repeat(20);
    assert({
      given: 'a cursor with each part at the 20-digit bound',
      should: 'accept it',
      actual: parseOutcome(cursorSchema, `${twentyDigits}:${twentyDigits}`),
      expected: { data: `${twentyDigits}:${twentyDigits}` },
    });
  });

  test('rejects a cursor with a part over 20 digits, or a non-canonical leading zero', () => {
    const twentyOneDigits = '1'.repeat(21);
    assert({
      given:
        'a cursor with a part past the 20-digit bound, and one with a leading zero',
      should: 'reject both',
      actual: [
        parseOutcome(cursorSchema, `${twentyOneDigits}:1`),
        parseOutcome(cursorSchema, '01:1'),
      ],
      expected: [{ issues: ['(root)'] }, { issues: ['(root)'] }],
    });
  });
});
