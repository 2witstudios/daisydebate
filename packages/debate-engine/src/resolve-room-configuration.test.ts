import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { FormatDefinition } from '@daisy/protocol';
import {
  oneOnOneDefinition,
  practiceConfig,
  practiceRules,
} from './runtime.test-support';
import { resolveRoomConfiguration } from './resolve-room-configuration';

setupRitewayBun();

describe('resolveRoomConfiguration', () => {
  test('resolves the practice room into room-executed and round-executed halves', () => {
    const outcome = resolveRoomConfiguration(
      oneOnOneDefinition,
      practiceConfig,
    );
    assert({
      given: 'the one-on-one definition and the practice config',
      should: 'resolve every segment at its default with prep and interaction',
      actual: outcome.ok && {
        keys: outcome.rules.segments.map((segment) => segment.key),
        durations: outcome.rules.segments.map((segment) => segment.durationMs),
        prep: outcome.rules.inRoundPrep,
        countdownMs: outcome.rules.countdownMs,
        roomPlan: outcome.roomPlan,
      },
      expected: outcome.ok && {
        keys: ['AC', 'CX1', 'NC', 'CX2', '1AR', 'NR', '2AR'],
        durations: [
          300_000, 120_000, 360_000, 120_000, 300_000, 300_000, 180_000,
        ],
        prep: {
          budgetMsPerSide: 240_000,
          spendableBefore: ['speech'],
          expiresAtSegment: null,
        },
        countdownMs: 10_000,
        roomPlan: { preRoundPrep: { enabled: false } },
      },
    });
  });

  test('resolves a partial override and keeps the rest at the defaults', () => {
    const outcome = resolveRoomConfiguration(oneOnOneDefinition, {
      ...practiceConfig,
      speechTiming: {
        countdownMs: 5_000,
        segmentDurationOverrides: { NC: 240_000, '2AR': 120_000 },
      },
    });
    assert({
      given: 'overrides on two segments only',
      should: 'override those and keep five defaults',
      actual:
        outcome.ok &&
        outcome.rules.segments.map((segment) => segment.durationMs),
      expected: [300_000, 120_000, 240_000, 120_000, 300_000, 300_000, 120_000],
    });
  });

  test('refuses a value outside the declared bounds as out-of-range', () => {
    const outcomes = [
      resolveRoomConfiguration(oneOnOneDefinition, {
        ...practiceConfig,
        speechTiming: {
          countdownMs: 120_000,
          segmentDurationOverrides: {},
        },
      }),
      resolveRoomConfiguration(oneOnOneDefinition, {
        ...practiceConfig,
        speechTiming: {
          countdownMs: 10_000,
          segmentDurationOverrides: { AC: 30_000 },
        },
      }),
      resolveRoomConfiguration(oneOnOneDefinition, {
        ...practiceConfig,
        inRoundPrep: { enabled: true, budgetMsPerSide: 900_000 },
      }),
    ];
    assert({
      given: 'a countdown, an override and a budget outside their bounds',
      should: 'refuse each as out-of-range',
      actual: outcomes.map((outcome) =>
        outcome.ok ? 'resolved' : outcome.refusal.kind,
      ),
      expected: ['out-of-range', 'out-of-range', 'out-of-range'],
    });
  });

  test('refuses what the definition forbids as capability-forbidden', () => {
    const forbidding: FormatDefinition = {
      ...oneOnOneDefinition,
      configurable: {
        ...oneOnOneDefinition.configurable,
        inRoundPrep: null,
        preRoundPrep: null,
        interaction: {
          crossExModes: ['ordered'],
          interruptions: null,
          yield: null,
        },
      },
    };
    const outcomes = [
      resolveRoomConfiguration(forbidding, practiceConfig),
      resolveRoomConfiguration(forbidding, {
        ...practiceConfig,
        inRoundPrep: { enabled: false },
        interruptions: null,
        yielding: null,
        preRoundPrep: { enabled: true, durationMs: 60_000 },
      }),
    ];
    assert({
      given: 'a config enabling prep on a format that forbids it',
      should: 'refuse as capability-forbidden',
      actual: outcomes.map((outcome) =>
        outcome.ok ? 'resolved' : outcome.refusal.kind,
      ),
      expected: ['capability-forbidden', 'capability-forbidden'],
    });
    assert({
      given: 'the same config minus every forbidden capability',
      should: 'resolve cleanly: declined is just absent from the rules',
      actual: resolveRoomConfiguration(forbidding, {
        ...practiceConfig,
        inRoundPrep: { enabled: false },
        interruptions: null,
        yielding: null,
      }).ok,
      expected: true,
    });
  });

  test('refuses a non-member of a permitted set as invalid-choice', () => {
    const outcomes = [
      resolveRoomConfiguration(
        {
          ...oneOnOneDefinition,
          configurable: {
            ...oneOnOneDefinition.configurable,
            interaction: {
              ...oneOnOneDefinition.configurable.interaction,
              yield: {
                enabledChoices: [true],
                returnsTimeChoices: [true, false],
              },
            },
          },
        },
        { ...practiceConfig, yielding: { allowed: false, returnsTime: true } },
      ),
      resolveRoomConfiguration(
        {
          ...oneOnOneDefinition,
          configurable: {
            ...oneOnOneDefinition.configurable,
            interaction: {
              ...oneOnOneDefinition.configurable.interaction,
              interruptions: {
                modes: ['disabled', 'cross_ex_only'],
                minRemainingMs: { min: 0, max: 300_000 },
              },
            },
          },
        },
        {
          ...practiceConfig,
          interruptions: { mode: 'enabled', minRemainingMs: 30_000 },
        },
      ),
    ];
    assert({
      given: 'a permitted-set member the definition did not list',
      should: 'refuse as invalid-choice in both interactions',
      actual: outcomes.map((outcome) =>
        outcome.ok ? 'resolved' : outcome.refusal.kind,
      ),
      expected: ['invalid-choice', 'invalid-choice'],
    });
  });

  test('refuses unknown segment keys in overrides and in prep expiry', () => {
    const outcomes = [
      resolveRoomConfiguration(oneOnOneDefinition, {
        ...practiceConfig,
        speechTiming: {
          countdownMs: 10_000,
          segmentDurationOverrides: { NR2: 300_000 },
        },
      }),
      resolveRoomConfiguration(
        {
          ...oneOnOneDefinition,
          configurable: {
            ...oneOnOneDefinition.configurable,
            inRoundPrep: {
              budgetMsPerSide: { min: 0, max: 600_000 },
              spendableBefore: ['speech'],
              expiresAtSegment: 'ZZ',
            },
          },
        },
        practiceConfig,
      ),
    ];
    assert({
      given: 'an override naming a missing segment and an expiry naming one',
      should: 'refuse both as unknown-segment-key',
      actual: outcomes.map((outcome) =>
        outcome.ok ? 'resolved' : outcome.refusal.kind,
      ),
      expected: ['unknown-segment-key', 'unknown-segment-key'],
    });
  });

  test('refuses an input the definition schema would never produce as incomplete-timing', () => {
    const untimed = {
      ...oneOnOneDefinition,
      segments: [
        {
          ...oneOnOneDefinition.segments[0],
          defaultDurationMs: 0,
        },
      ],
      configurable: {
        ...oneOnOneDefinition.configurable,
        timing: {
          ...oneOnOneDefinition.configurable.timing,
          segmentDurationMs: {},
        },
      },
    } as unknown as FormatDefinition;
    const outcome = resolveRoomConfiguration(untimed, {
      ...practiceConfig,
      speechTiming: { countdownMs: 10_000, segmentDurationOverrides: {} },
    });
    assert({
      given: 'a segment with neither an override nor a usable default',
      should: 'refuse as incomplete-timing',
      actual: outcome.ok ? 'resolved' : outcome.refusal.kind,
      expected: 'incomplete-timing',
    });
  });

  test('carries the prep bounds from the definition, never from the room', () => {
    assert({
      given: 'a room choosing only its prep budget',
      should:
        'copy spendableBefore and expiresAtSegment from the definition verbatim',
      actual: practiceRules().inRoundPrep,
      expected: {
        budgetMsPerSide: 240_000,
        spendableBefore: ['speech'],
        expiresAtSegment: null,
      },
    });
  });
});

test('null controls cannot omit declared interaction choices', () => {
  for (const restricted of [true, false]) {
    const definition: FormatDefinition = {
      ...oneOnOneDefinition,
      configurable: {
        ...oneOnOneDefinition.configurable,
        interaction: {
          crossExModes: ['ordered'],
          interruptions: {
            modes: restricted ? ['enabled'] : ['disabled'],
            minRemainingMs: { min: 0, max: 1000 },
          },
          yield: { enabledChoices: [!restricted], returnsTimeChoices: [true] },
        },
      },
    };
    const config = {
      ...practiceConfig,
      interruptions: {
        mode: restricted ? ('enabled' as const) : ('disabled' as const),
        minRemainingMs: 0,
      },
      yielding: { allowed: !restricted, returnsTime: true },
    };
    assert({
      given: 'explicit permitted interaction values',
      should: 'resolve them',
      actual: resolveRoomConfiguration(definition, config).ok,
      expected: true,
    });
    for (const field of ['interruptions', 'yielding'] as const) {
      const result = resolveRoomConfiguration(definition, {
        ...config,
        [field]: null,
      });
      assert({
        given: `a declared ${field} capability with a null control`,
        should: 'require an explicit permitted choice',
        actual: result.ok ? 'resolved' : result.refusal.kind,
        expected: 'invalid-choice',
      });
    }
  }
});
