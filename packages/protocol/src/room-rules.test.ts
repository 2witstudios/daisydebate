import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  ballotCategories,
  ballotScoresSchema,
  roomConfigSchema,
  roundRulesSchema,
  runtimeCheckpointSchema,
  emptyRuntimeCheckpoint,
} from './index';
import { parseOutcome } from './parse-outcome.test-support';

setupRitewayBun();

const id = 'k2v9x0f4m8q3w1z7c5n6b4d2';

describe('room config', () => {
  const config = {
    preRoundPrep: { enabled: true, durationMs: 1_200_000 },
    inRoundPrep: { enabled: true, budgetMsPerSide: 240_000 },
    speechTiming: {
      countdownMs: 10_000,
      segmentDurationOverrides: { NC: 360_000 },
    },
    crossExamination: { crossExMode: 'ordered' },
    interruptions: { mode: 'cross_ex_only', minRemainingMs: 30_000 },
    yielding: { allowed: true, returnsTime: true },
  };

  test('accepts a full config and keeps it verbatim', () => {
    assert({
      given: 'a room config choosing every capability',
      should: 'parse to an equal value',
      actual: parseOutcome(roomConfigSchema, config),
      expected: { data: config },
    });
  });

  test('spells declined as enabled false, and nothing else', () => {
    const declined = roomConfigSchema.safeParse({
      ...config,
      preRoundPrep: { enabled: false },
      inRoundPrep: { enabled: false },
    });
    assert({
      given: 'both preps declined',
      should: 'accept them',
      actual: declined.success ? declined.data.preRoundPrep : declined.error,
      expected: { enabled: false },
    });
    assert({
      given: 'a prep disabled by an enabled:false flag at the wrong level',
      should: 'reject it: forbidden is the null capability, not a flag',
      actual: parseOutcome(roomConfigSchema, {
        ...config,
        inRoundPrep: { enabled: true, budgetMsPerSide: -1 },
      }),
      expected: { issues: ['inRoundPrep.budgetMsPerSide'] },
    });
  });

  test('rejects a non-member of a permitted set', () => {
    assert({
      given: 'a cross-examination mode the definition never permitted',
      should: 'reject it at the boundary',
      actual: parseOutcome(roomConfigSchema, {
        ...config,
        crossExamination: { crossExMode: 'chaotic' },
      }),
      expected: { issues: ['crossExamination.crossExMode'] },
    });
  });
});

describe('round rules', () => {
  const rules = {
    version: 2,
    seats: { affirmative: 1, negative: 1, judge: 1 },
    segments: [
      {
        key: 'A1',
        label: 'Affirmative speech',
        type: 'speech',
        side: 'affirmative',
        slot: 0,
        durationMs: 60_000,
      },
      {
        key: 'CX',
        label: 'Cross-examination',
        type: 'cross_ex',
        side: 'negative',
        slot: 0,
        durationMs: 45_000,
      },
    ],
    inRoundPrep: null,
    countdownMs: 0,
    interaction: {
      crossExMode: 'free',
      yield: null,
      interruptions: null,
    },
  };

  test('accepts the resolved rules verbatim', () => {
    assert({
      given: 'resolved rules with every field traced to an input',
      should: 'parse to an equal value',
      actual: parseOutcome(roundRulesSchema, rules),
      expected: { data: rules },
    });
  });

  test('is strict about unknown fields and resolved durations', () => {
    assert({
      given:
        'rules carrying a pre-round prep policy, which never reaches a round',
      should: 'reject them',
      actual: parseOutcome(roundRulesSchema, {
        ...rules,
        preRoundPrep: { enabled: true, durationMs: 60_000 },
      }),
      expected: { issues: ['(root)'] },
    });
    assert({
      given: 'a segment duration that is a range rather than a resolved value',
      should: 'reject it',
      actual: parseOutcome(roundRulesSchema, {
        ...rules,
        segments: rules.segments.map((segment, index) =>
          index === 0 ? { ...segment, durationMs: 0 } : segment,
        ),
      }),
      expected: { issues: ['segments.0.durationMs'] },
    });
  });
});

describe('runtime checkpoint', () => {
  test('accepts the empty checkpoint and keeps the stored key spelling', () => {
    assert({
      given: 'the checkpoint a fresh round hydrates with',
      should: 'parse to an equal value',
      actual: parseOutcome(runtimeCheckpointSchema, emptyRuntimeCheckpoint),
      expected: {
        data: {
          version: 1,
          prep_consumed_ms: { affirmative: 0, negative: 0 },
          active_prep: null,
          floor: null,
        },
      },
    });
  });

  test('accepts a live prep anchor and an interruption floor', () => {
    const live = {
      version: 1,
      prep_consumed_ms: { affirmative: 30_000, negative: 0 },
      active_prep: {
        side: 'affirmative',
        started_at: '2026-01-01T00:04:00.000Z',
      },
      floor: {
        holder_participant_id: id,
        granted_at: '2026-01-01T00:04:30.000Z',
      },
    };
    assert({
      given: 'a checkpoint taken mid-prep after an accepted interruption',
      should: 'parse to an equal value',
      actual: parseOutcome(runtimeCheckpointSchema, live),
      expected: { data: live },
    });
    assert({
      given: 'a checkpoint whose prep consumption is negative',
      should: 'reject it',
      actual: parseOutcome(runtimeCheckpointSchema, {
        ...live,
        prep_consumed_ms: { affirmative: -1, negative: 0 },
      }),
      expected: { issues: ['prep_consumed_ms.affirmative'] },
    });
  });
});

describe('ballot scores', () => {
  const scores = {
    affirmative: Object.fromEntries(
      ballotCategories.map((category, index) => [category, (index % 5) + 1]),
    ),
    negative: Object.fromEntries(
      ballotCategories.map((category) => [category, 3]),
    ),
  };

  test('accepts ten category scores for each side', () => {
    assert({
      given: 'one score per category per side inside 1-5',
      should: 'parse to an equal value',
      actual: parseOutcome(ballotScoresSchema, scores),
      expected: { data: scores },
    });
  });

  test('rejects a score outside the rubric range', () => {
    assert({
      given: 'a zero score',
      should: 'reject it',
      actual: parseOutcome(ballotScoresSchema, {
        ...scores,
        affirmative: { ...scores.affirmative, thesis: 0 },
      }),
      expected: { issues: ['affirmative.thesis'] },
    });
    assert({
      given: 'a missing category',
      should: 'reject it',
      actual: parseOutcome(ballotScoresSchema, {
        ...scores,
        negative: Object.fromEntries(
          Object.entries(scores.negative).filter(
            ([category]) => category !== 'thesis',
          ),
        ),
      }).issues?.includes('negative.thesis'),
      expected: true,
    });
  });
});
