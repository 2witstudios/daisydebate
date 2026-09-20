import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  commandSchema,
  errorSchema,
  eventSchema,
  debateSnapshotSchema,
} from './index';

setupRitewayBun();

const id = 'k2v9x0f4m8q3w1z7c5n6b4d2';

describe('command schema', () => {
  test('validates intent, rejects future versions and extraneous fields', () => {
    const command = {
      version: 1,
      type: 'debate.ready',
      commandId: id,
      debateId: id,
      participantId: id,
    } as const;
    assert({
      given: 'a valid version 1 command',
      should: 'parse to an equal command',
      actual: commandSchema.parse(command),
      expected: command,
    });
    assert({
      given: 'a command stamped with a future version',
      should: 'reject it',
      actual: commandSchema.safeParse({ ...command, version: 2 }).success,
      expected: false,
    });
    assert({
      given: 'a command carrying extraneous permissions',
      should: 'reject it',
      actual: commandSchema.safeParse({ ...command, permissions: ['admin'] })
        .success,
      expected: false,
    });
    assert({
      given: 'a command with a non-string participant id',
      should: 'reject it',
      actual: commandSchema.safeParse({ ...command, participantId: 1 }).success,
      expected: false,
    });
  });
});

describe('event and snapshot schemas', () => {
  test('have separate portable contracts', () => {
    assert({
      given: 'a valid phase-changed event',
      should: 'accept it',
      actual: eventSchema.safeParse({
        version: 1,
        type: 'debate.phase-changed',
        eventId: id,
        debateId: id,
        occurredAt: '2026-01-01T00:00:00.000Z',
        phase: 'active',
      }).success,
      expected: true,
    });
    assert({
      given: 'a valid waiting-phase snapshot',
      should: 'accept it',
      actual: debateSnapshotSchema.safeParse({
        version: 1,
        id,
        resolution: 'Test',
        format: 'foundation',
        phase: 'waiting',
        createdAt: '2026-01-01T00:00:00.000Z',
        participants: [],
      }).success,
      expected: true,
    });
  });
});

describe('identifier shape', () => {
  test('accepts exactly cuid2 and rejects every other identifier form', () => {
    const rejections = [
      ['a canonical legacy UUID', '0f0e6d1c-2b3a-4455-9a8b-7c6d5e4f3a21'],
      ['an uppercase UUID', '0F0E6D1C-2B3A-4455-9A8B-7C6D5E4F3A21'],
      ['a UUID without dashes', '0f0e6d1c2b3a44559a8b7c6d5e4f3a21'],
      ['a braced UUID', '{0f0e6d1c-2b3a-4455-9a8b-7c6d5e4f3a21}'],
      ['a 23-character truncated cuid2', id.slice(1)],
      ['a 25-character padded id', `${id}a`],
      ['an empty identifier', ''],
      ['an arbitrary string', 'not-an-identifier'],
      ['an identifier with spaces', `${id} `],
    ] as const;
    for (const [given, identifier] of rejections)
      assert({
        given: `a snapshot id that is ${given}`,
        should: 'reject it at the trust boundary',
        actual: debateSnapshotSchema.safeParse({
          version: 1,
          id: identifier,
          resolution: 'Test',
          format: 'foundation',
          phase: 'waiting',
          createdAt: '2026-01-01T00:00:00.000Z',
          participants: [],
        }).success,
        expected: false,
      });
  });
});

describe('error schema', () => {
  test('accepts a stable invariant identity on invariant errors', () => {
    assert({
      given: 'a version 1 invariant error with its registered identity',
      should: 'accept the portable error contract',
      actual: errorSchema.safeParse({
        version: 1,
        type: 'error',
        code: 'INVARIANT',
        message: 'Domain operation is not allowed',
        requestId: 'request-1',
        invariantId: 'debate.phase.active.requires-ready-participants',
      }).success,
      expected: true,
    });
  });
});
