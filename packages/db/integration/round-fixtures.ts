/**
 * The shared competitive fixtures every constraint suite writes rounds
 * with: the grammar, the room config it sanctions and the rules it resolves.
 */

/**
 * The two-speech foundation grammar, as a FormatDefinition revision and as the
 * resolved RoundRules a fixture round freezes. They describe each other, so a
 * fixture round's `rules_snapshot` matches the revision it pins — which is what
 * `rounds_definition_revision_fk` and the write-path invariants assume.
 */
export const foundationDefinition = {
  version: 1,
  seats: { affirmative: 1, negative: 1, judge: 0 },
  segments: [
    {
      key: 'AC',
      label: 'Affirmative constructive',
      type: 'speech',
      side: 'affirmative',
      slot: 0,
      defaultDurationMs: 240_000,
    },
    {
      key: 'NC',
      label: 'Negative constructive',
      type: 'speech',
      side: 'negative',
      slot: 0,
      defaultDurationMs: 240_000,
    },
  ],
  configurable: {
    timing: {
      segmentDurationMs: {
        AC: { min: 60_000, max: 600_000 },
        NC: { min: 60_000, max: 600_000 },
      },
      countdownMs: { min: 0, max: 60_000 },
    },
    inRoundPrep: {
      budgetMsPerSide: { min: 0, max: 600_000 },
      spendableBefore: ['speech'],
      expiresAtSegment: null,
    },
    preRoundPrep: null,
    interaction: {
      crossExModes: ['ordered'],
      interruptions: null,
      yield: null,
    },
  },
};

/** The casual config a practice room starts from; a preset's approved value. */
export const validConfig = {
  preRoundPrep: { enabled: false },
  inRoundPrep: { enabled: true, budgetMsPerSide: 120_000 },
  speechTiming: { countdownMs: 10_000, segmentDurationOverrides: {} },
  crossExamination: { crossExMode: 'ordered' },
  interruptions: null,
  yielding: null,
};

export { validRules } from '../src/index.test-support';
