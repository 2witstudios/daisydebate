import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  ballotCategories,
  competitionTypes,
  emptyRuntimeCheckpoint,
  formatDefinitionSchema,
  roundLengths,
  roundStatuses,
  runtimeCheckpointSchema,
  seatSlotsComplete,
  speakerTotal,
} from './index';
import {
  debateRoleSchema,
  debateRoles,
  debateSideSchema,
  debateSides,
  errorSchema,
} from './primitives';
import { parseOutcome } from './parse-outcome.test-support';

setupRitewayBun();

const id = 'k2v9x0f4m8q3w1z7c5n6b4d2';

/** The one-on-one practice format, as the definition schema expects it. */
const oneOnOne = {
  version: 1,
  seats: { affirmative: 1, negative: 1, judge: 1 },
  segments: [
    {
      key: 'AC',
      label: 'Affirmative constructive',
      type: 'speech',
      side: 'affirmative',
      slot: 0,
      defaultDurationMs: 300_000,
    },
    {
      key: 'CX',
      label: 'Cross-examination of the affirmative',
      type: 'cross_ex',
      side: 'negative',
      slot: 0,
      defaultDurationMs: 120_000,
    },
  ],
  configurable: {
    timing: {
      segmentDurationMs: {
        AC: { min: 60_000, max: 600_000 },
        CX: { min: 30_000, max: 300_000 },
      },
      countdownMs: { min: 0, max: 60_000 },
    },
    inRoundPrep: {
      budgetMsPerSide: { min: 0, max: 600_000 },
      spendableBefore: ['speech'],
      expiresAtSegment: null,
    },
    preRoundPrep: { durationMs: { min: 0, max: 3_600_000 } },
    interaction: {
      crossExModes: ['ordered', 'free'],
      interruptions: {
        modes: ['disabled', 'cross_ex_only', 'enabled'],
        minRemainingMs: { min: 0, max: 300_000 },
      },
      yield: { enabledChoices: [true], returnsTimeChoices: [true, false] },
    },
  },
} as const;

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
        given: `a checkpoint floor holder that is ${given}`,
        should: 'reject it at the trust boundary',
        actual: parseOutcome(runtimeCheckpointSchema, {
          ...emptyRuntimeCheckpoint,
          floor: {
            holder_participant_id: identifier,
            granted_at: '2026-01-01T00:00:00.000Z',
          },
        }),
        expected: { issues: ['floor.holder_participant_id'] },
      });
  });
});

describe('error schema', () => {
  test('accepts a stable invariant identity on invariant errors', () => {
    const invariantError = {
      version: 1,
      type: 'error',
      code: 'INVARIANT',
      message: 'Domain operation is not allowed',
      requestId: 'request-1',
      invariantId: 'round.live.exactly-one-open-segment',
    };
    assert({
      given: 'a version 1 invariant error with its registered identity',
      should: 'accept the portable error contract',
      actual: parseOutcome(errorSchema, invariantError),
      expected: { data: invariantError },
    });
  });

  test('accepts the payload-too-large code', () => {
    const tooLarge = {
      version: 1,
      type: 'error',
      code: 'PAYLOAD_TOO_LARGE',
      message: 'Request body too large',
      requestId: 'request-1',
    };
    assert({
      given: 'a version 1 error reporting an oversized request body',
      should: 'accept the portable error contract',
      actual: parseOutcome(errorSchema, tooLarge),
      expected: { data: tooLarge },
    });
  });
});

describe('roles and sides', () => {
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
        ...debateSides.map((side) => parseOutcome(debateSideSchema, side)),
        parseOutcome(debateSideSchema, 'judge'),
      ],
      expected: [
        ...debateSides.map((side) => ({ data: side })),
        { issues: ['(root)'] },
      ],
    });
  });

  test('own the role vocabulary once', () => {
    assert({
      given: 'the derived zod enum',
      should: 'accept every role and reject a spectator',
      actual: [
        ...debateRoles.map((role) => parseOutcome(debateRoleSchema, role)),
        parseOutcome(debateRoleSchema, 'spectator'),
      ],
      expected: [
        ...debateRoles.map((role) => ({ data: role })),
        { issues: ['(root)'] },
      ],
    });
  });
});

describe('competition vocabulary', () => {
  test('names the competition types, lengths and statuses', () => {
    assert({
      given: 'the competition vocabulary',
      should: 'be exactly ranked, casual and practice',
      actual: competitionTypes,
      expected: ['ranked', 'casual', 'practice'],
    });
    assert({
      given: 'the length vocabulary',
      should: 'be exactly full and quick',
      actual: roundLengths,
      expected: ['full', 'quick'],
    });
    assert({
      given: 'the status vocabulary',
      should: 'be scheduled, active, completed and abandoned',
      actual: roundStatuses,
      expected: ['scheduled', 'active', 'completed', 'abandoned'],
    });
  });
});

describe('format definition', () => {
  test('accepts the one-on-one definition and keeps it verbatim', () => {
    assert({
      given: 'the one-on-one definition',
      should: 'parse to an equal value',
      actual: parseOutcome(formatDefinitionSchema, oneOnOne),
      expected: { data: oneOnOne },
    });
  });

  test('requires the timing bounds to correspond exactly to the segments', () => {
    const extra = {
      ...oneOnOne,
      configurable: {
        ...oneOnOne.configurable,
        timing: {
          ...oneOnOne.configurable.timing,
          segmentDurationMs: {
            ...oneOnOne.configurable.timing.segmentDurationMs,
            NR: { min: 60_000, max: 300_000 },
          },
        },
      },
    };
    const missing = {
      ...oneOnOne,
      configurable: {
        ...oneOnOne.configurable,
        timing: {
          ...oneOnOne.configurable.timing,
          segmentDurationMs: {
            AC: oneOnOne.configurable.timing.segmentDurationMs.AC,
          },
        },
      },
    };
    assert({
      given: 'a bounds entry for a segment that does not exist',
      should: 'reject it',
      actual: parseOutcome(formatDefinitionSchema, extra),
      expected: {
        issues: ['configurable.timing.segmentDurationMs'],
      },
    });
    assert({
      given: 'a definition whose bounds miss a segment',
      should: 'reject it',
      actual: parseOutcome(formatDefinitionSchema, missing),
      expected: { issues: ['configurable.timing.segmentDurationMs'] },
    });
  });

  test('requires unique segment keys', () => {
    const duplicated = {
      ...oneOnOne,
      segments: [
        oneOnOne.segments[0],
        oneOnOne.segments[0],
        oneOnOne.segments[1],
      ],
    };
    assert({
      given: 'two segments sharing a key',
      should: 'reject them, and the bounds that no longer correspond',
      actual: parseOutcome(formatDefinitionSchema, duplicated),
      expected: {
        issues: ['segments', 'configurable.timing.segmentDurationMs'],
      },
    });
  });

  test('requires every segment to carry its default duration', () => {
    const untimed = {
      ...oneOnOne,
      segments: [
        {
          key: 'AC',
          label: 'Affirmative constructive',
          type: 'speech',
          side: 'affirmative',
          slot: 0,
        },
      ],
    };
    assert({
      given: 'a segment without a defaultDurationMs',
      should: 'reject it',
      actual: parseOutcome(formatDefinitionSchema, untimed),
      expected: { issues: ['segments.0.defaultDurationMs'] },
    });
  });

  test('keeps the capabilities nullable, so a null forbids outright', () => {
    const spartan = {
      ...oneOnOne,
      configurable: {
        ...oneOnOne.configurable,
        inRoundPrep: null,
        preRoundPrep: null,
        interaction: {
          crossExModes: ['ordered'],
          interruptions: null,
          yield: null,
        },
      },
    };
    assert({
      given: 'a definition that forbids prep and interruption outright',
      should: 'accept it: null is forbidden, not disabled',
      actual: parseOutcome(formatDefinitionSchema, spartan),
      expected: { data: spartan },
    });
  });
});

describe('speaker total', () => {
  test('sums one side’s ten category scores', () => {
    const scores = Object.fromEntries(
      ballotCategories.map((category, index) => [category, index + 1]),
    ) as Record<(typeof ballotCategories)[number], number>;
    assert({
      given: 'the ten category scores 1 through 10',
      should: 'sum them',
      actual: speakerTotal(scores),
      expected: 55,
    });
  });
});

describe('seat completeness', () => {
  test('accepts exactly the slots 0..wanted-1 and refuses anything else', () => {
    assert({
      given: 'two held slots for a two-seat role',
      should: 'accept them in order',
      actual: seatSlotsComplete(2, [0, 1]),
      expected: true,
    });
    assert({
      given: 'a missing slot',
      should: 'refuse an incomplete role',
      actual: seatSlotsComplete(2, [0]),
      expected: false,
    });
    assert({
      given: 'an out-of-range slot',
      should: 'refuse slots that skip a number',
      actual: seatSlotsComplete(2, [0, 2]),
      expected: false,
    });
    assert({
      given: 'an extra seat',
      should: 'refuse more seats than the role declares',
      actual: seatSlotsComplete(1, [0, 1]),
      expected: false,
    });
  });
});
