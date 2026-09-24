import { expect } from 'bun:test';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { cursorSchema } from './realtime';
import { buildUserInboxTopic, parseTopic, topicStringSchema } from './topics';
import { parseOutcome } from './parse-outcome.test-support';

setupRitewayBun();

const id = 'k2v9x0f4m8q3w1z7c5n6b4d2';

describe('topic grammar', () => {
  test('parses every topic family, and the inbox builder round-trips', () => {
    assert({
      given: 'an actor id',
      should: 'build the inbox topic',
      actual: buildUserInboxTopic(id),
      expected: `user:${id}:inbox`,
    });
    assert({
      given: 'a topic of every family',
      should: 'parse to the matching family and ids',
      actual: [
        parseTopic(`debate:${id}`),
        parseTopic(`debate:${id}:presence`),
        parseTopic(`debate:${id}:chat`),
        parseTopic(buildUserInboxTopic(id)),
        parseTopic('standings:2026'),
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

  test('the builder throws on a non-cuid2 segment instead of building a bad topic', () => {
    expect(() => buildUserInboxTopic('not-a-cuid2')).toThrow(
      'Invalid string: must match pattern',
    );
  });

  test('rejects a season slug with a trailing hyphen', () => {
    assert({
      given: 'a season slug ending in a hyphen',
      should: 'reject it',
      actual: [
        parseTopic('standings:2026-') !== undefined,
        parseTopic('standings:2026') !== undefined,
        parseTopic('standings:fall-2026') !== undefined,
      ],
      expected: [false, true, true],
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
