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
