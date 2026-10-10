import type { FormatDefinition } from './index';

/** Shared practice-format fixture for protocol and engine contract tests. */
export const practiceFormatFixture: FormatDefinition = {
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
      key: 'CX1',
      label: 'Cross-examination of the affirmative',
      type: 'cross_ex',
      side: 'negative',
      slot: 0,
      defaultDurationMs: 120_000,
    },
    {
      key: 'NC',
      label: 'Negative constructive',
      type: 'speech',
      side: 'negative',
      slot: 0,
      defaultDurationMs: 360_000,
    },
    {
      key: 'CX2',
      label: 'Cross-examination of the negative',
      type: 'cross_ex',
      side: 'affirmative',
      slot: 0,
      defaultDurationMs: 120_000,
    },
    {
      key: '1AR',
      label: 'First affirmative rebuttal',
      type: 'speech',
      side: 'affirmative',
      slot: 0,
      defaultDurationMs: 300_000,
    },
    {
      key: 'NR',
      label: 'Negative rebuttal',
      type: 'speech',
      side: 'negative',
      slot: 0,
      defaultDurationMs: 300_000,
    },
    {
      key: '2AR',
      label: 'Second affirmative rebuttal',
      type: 'speech',
      side: 'affirmative',
      slot: 0,
      defaultDurationMs: 180_000,
    },
  ],
  configurable: {
    timing: {
      segmentDurationMs: {
        AC: { min: 60_000, max: 600_000 },
        CX1: { min: 30_000, max: 300_000 },
        NC: { min: 60_000, max: 600_000 },
        CX2: { min: 30_000, max: 300_000 },
        '1AR': { min: 60_000, max: 600_000 },
        NR: { min: 60_000, max: 600_000 },
        '2AR': { min: 30_000, max: 600_000 },
      },
      countdownMs: { min: 0, max: 60_000 },
    },
    inRoundPrep: {
      budgetMsPerSide: { min: 0, max: 600_000 },
      spendableBefore: ['speech'],
      expiresAtSegment: null,
    },
    preRoundPrep: { durationMs: { min: 0, max: 1_200_000 } },
    interaction: {
      crossExModes: ['ordered', 'free'],
      interruptions: {
        modes: ['disabled', 'cross_ex_only', 'enabled'],
        minRemainingMs: { min: 0, max: 300_000 },
      },
      yield: {
        enabledChoices: [true, false],
        returnsTimeChoices: [true, false],
      },
    },
  },
};
