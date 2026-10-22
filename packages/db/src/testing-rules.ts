import type { RoundRules } from '@daisy/protocol';

/** The resolved rules every fixture round freezes, for tests that write rounds. */
export const validRules: RoundRules = {
  version: 2,
  seats: { affirmative: 1, negative: 1, judge: 0 },
  segments: [
    {
      key: 'AC',
      label: 'Affirmative constructive',
      type: 'speech',
      side: 'affirmative',
      slot: 0,
      durationMs: 240_000,
    },
    {
      key: 'NC',
      label: 'Negative constructive',
      type: 'speech',
      side: 'negative',
      slot: 0,
      durationMs: 240_000,
    },
  ],
  inRoundPrep: {
    budgetMsPerSide: 120_000,
    spendableBefore: ['speech'],
    expiresAtSegment: null,
  },
  countdownMs: 10_000,
  interaction: {
    crossExMode: 'ordered',
    yield: null,
    interruptions: null,
  },
};
