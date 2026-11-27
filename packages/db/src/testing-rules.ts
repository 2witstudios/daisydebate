import { affirmativeSide, negativeSide, twoSides } from '@daisy/protocol/seats';
import { type RoundRules } from '@daisy/protocol/format';

/** The resolved rules every fixture round freezes, for tests that write rounds. */
export const validRules: RoundRules = {
  version: 3,
  sides: [...twoSides],
  seats: {
    sides: { [affirmativeSide]: 1, [negativeSide]: 1 },
    speakers: 0,
    judges: 0,
    moderators: 0,
  },
  outcome: { kind: 'winner' },
  segments: [
    {
      key: 'AC',
      label: 'Affirmative constructive',
      type: 'speech',
      speak: {
        rights: 'one',
        seat: { kind: 'side', side: affirmativeSide, slot: 0 },
      },
      durationMs: 240_000,
    },
    {
      key: 'NC',
      label: 'Negative constructive',
      type: 'speech',
      speak: {
        rights: 'one',
        seat: { kind: 'side', side: negativeSide, slot: 0 },
      },
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
    yield: null,
    pointsOfInformation: { allowed: false as const },
  },
};
