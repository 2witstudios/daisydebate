import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { debateSnapshotSchema, formatRulesSchema } from './index';
import {
  debateRoleSchema,
  debateRoles,
  debateSideSchema,
  debateSides,
  errorSchema,
} from './primitives';

setupRitewayBun();

const id = 'k2v9x0f4m8q3w1z7c5n6b4d2';

describe('snapshot schema', () => {
  test('accepts a valid waiting-phase snapshot', () => {
    assert({
      given: 'a valid waiting-phase snapshot',
      should: 'accept it',
      actual: debateSnapshotSchema.safeParse({
        version: 1,
        id,
        resolution: 'Test',
        format: 'foundation',
        rules: {
          version: 1,
          seats: { affirmative: 1, negative: 1, judge: 0 },
          clock: { speechMs: 240_000, prepMs: 120_000 },
        },
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

  test('accepts the payload-too-large code', () => {
    assert({
      given: 'a version 1 error reporting an oversized request body',
      should: 'accept the portable error contract',
      actual: errorSchema.safeParse({
        version: 1,
        type: 'error',
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Request body too large',
        requestId: 'request-1',
      }).success,
      expected: true,
    });
  });
});

describe('debate roles and format rules', () => {
  test('own the side vocabulary once, and build the roles from it', () => {
    assert({
      given: 'the canonical side array',
      should: 'list affirmative and negative in that order',
      actual: debateSides,
      expected: ['affirmative', 'negative'],
    });
    assert({
      given: 'the role array',
      should: 'begin with exactly the sides, then the judge',
      actual: debateRoles,
      expected: [...debateSides, 'judge'],
    });
    assert({
      given: 'the side schema built from the side array',
      should:
        'accept each side and reject the judge, which is a role but not a side',
      actual: [
        ...debateSides.map((side) => debateSideSchema.safeParse(side).success),
        debateSideSchema.safeParse('judge').success,
      ],
      expected: [true, true, false],
    });
  });

  test('own the role vocabulary once', () => {
    assert({
      given: 'the canonical role array',
      should: 'list affirmative, negative and judge in that order',
      actual: debateRoles,
      expected: ['affirmative', 'negative', 'judge'],
    });
    assert({
      given: 'the derived zod enum',
      should: 'accept every role and reject a spectator',
      actual: [
        ...debateRoles.map((role) => debateRoleSchema.safeParse(role).success),
        debateRoleSchema.safeParse('spectator').success,
      ],
      expected: [true, true, true, false],
    });
  });

  test('require an exhaustive seat map with non-negative integer counts', () => {
    const rules = {
      version: 1,
      seats: { affirmative: 1, negative: 1, judge: 0 },
      clock: { speechMs: 240_000, prepMs: 120_000 },
    };
    assert({
      given: 'rules with one seat per side, no judge and a millisecond clock',
      should: 'parse to an equal value',
      actual: formatRulesSchema.parse(rules),
      expected: rules,
    });
    const missingJudge = { affirmative: 1, negative: 1 };
    assert({
      given: 'a seat map missing the judge key',
      should: 'reject it',
      actual: formatRulesSchema.safeParse({ ...rules, seats: missingJudge })
        .success,
      expected: false,
    });
    assert({
      given: 'a seat map with a role outside the vocabulary',
      should: 'reject it',
      actual: formatRulesSchema.safeParse({
        ...rules,
        seats: { ...rules.seats, spectator: 1 },
      }).success,
      expected: false,
    });
    assert({
      given: 'a negative or fractional seat count',
      should: 'reject both',
      actual: [
        formatRulesSchema.safeParse({
          ...rules,
          seats: { ...rules.seats, judge: -1 },
        }).success,
        formatRulesSchema.safeParse({
          ...rules,
          seats: { ...rules.seats, negative: 1.5 },
        }).success,
      ],
      expected: [false, false],
    });
    assert({
      given: 'a clock with a fractional or zero speech duration',
      should: 'reject both',
      actual: [
        formatRulesSchema.safeParse({
          ...rules,
          clock: { speechMs: 1000.5, prepMs: 0 },
        }).success,
        formatRulesSchema.safeParse({
          ...rules,
          clock: { speechMs: 0, prepMs: 0 },
        }).success,
      ],
      expected: [false, false],
    });
  });
});

describe('snapshot rules', () => {
  const snapshot = {
    version: 1,
    id,
    resolution: 'Test',
    format: 'foundation',
    rules: {
      version: 1,
      seats: { affirmative: 1, negative: 1, judge: 0 },
      clock: { speechMs: 240_000, prepMs: 120_000 },
    },
    phase: 'waiting',
    createdAt: '2026-01-01T00:00:00.000Z',
    participants: [],
  };
  test('carry the effective rules the debate runs under', () => {
    assert({
      given: 'a snapshot with a format slug and effective rules',
      should: 'accept it and keep the rules verbatim',
      actual: debateSnapshotSchema.parse(snapshot).rules,
      expected: snapshot.rules,
    });
    assert({
      given: 'a snapshot without rules, or with rules missing a seat key',
      should: 'reject both',
      actual: [
        debateSnapshotSchema.safeParse({ ...snapshot, rules: undefined })
          .success,
        debateSnapshotSchema.safeParse({
          ...snapshot,
          rules: { ...snapshot.rules, seats: { affirmative: 1, negative: 1 } },
        }).success,
      ],
      expected: [false, false],
    });
    assert({
      given: 'format slugs',
      should: 'accept lowercase slugs and reject other shapes',
      actual: ['ipda', 'lincoln-douglas-2', 'Foundation', 'a b', ''].map(
        (format) =>
          debateSnapshotSchema.safeParse({ ...snapshot, format }).success,
      ),
      expected: [true, true, false, false, false],
    });
  });
});
