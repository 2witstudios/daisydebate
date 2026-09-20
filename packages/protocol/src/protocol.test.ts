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

describe('legacy identifier compatibility', () => {
  const legacyDebateId = '0f0e6d1c-2b3a-4455-9a8b-7c6d5e4f3a21';
  const legacyUserId = '8a7b6c5d-4e3f-4a2b-9c1d-0e9f8a7b6c5d';

  test('accepts durable version-1 snapshots minted before cuid2', () => {
    const legacySnapshot = {
      version: 1 as const,
      id: legacyDebateId,
      resolution: 'A pre-cuid2 resolution',
      format: 'foundation' as const,
      phase: 'waiting' as const,
      createdAt: '2025-01-01T00:00:00.000Z',
      participants: [
        {
          id: legacyUserId,
          side: 'affirmative' as const,
          ready: false,
        },
      ],
    };
    assert({
      given: 'a version-1 snapshot whose identities are legacy UUIDs',
      should: 'accept it without reminting or normalizing identity',
      actual: debateSnapshotSchema.parse(legacySnapshot),
      expected: legacySnapshot,
    });
  });

  test('accepts legacy UUID debate identities on commands and events', () => {
    const command = {
      version: 1,
      type: 'debate.join',
      commandId: id,
      debateId: legacyDebateId,
      participantId: legacyUserId,
      side: 'negative',
    } as const;
    assert({
      given: 'a new command acting on a legacy UUID debate',
      should: 'accept the mixed identity shapes',
      actual: commandSchema.parse(command),
      expected: command,
    });
    assert({
      given: 'a phase-changed event for a legacy UUID debate',
      should: 'accept the legacy debate identity',
      actual: eventSchema.safeParse({
        version: 1,
        type: 'debate.phase-changed',
        eventId: id,
        debateId: legacyDebateId,
        occurredAt: '2025-01-01T00:00:00.000Z',
        phase: 'active',
      }).success,
      expected: true,
    });
  });

  test('rejects identifiers outside the two documented shapes', () => {
    const rejections = [
      ['an uppercase legacy UUID', legacyDebateId.toUpperCase()],
      ['a UUID without dashes', legacyDebateId.replaceAll('-', '')],
      ['a 23-character truncated cuid2', id.slice(1)],
      ['a 25-character padded id', `${id}a`],
      ['a braced legacy UUID', `{${legacyDebateId}}`],
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
