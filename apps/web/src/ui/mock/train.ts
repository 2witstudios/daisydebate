import type { TrainingSummary } from '../../features/train/summary';

/**
 * A sample account that trains: three sessions this week, 42 saved arguments
 * with six due, and an impact that keeps coming up thin. Every number is a
 * sample; the training read replaces this file's use in `get-summary.ts`.
 */
export const sampleSummary: TrainingSummary = {
  sessions: 31,
  week: {
    days: [true, false, true, true, false, false, false],
    goal: 3,
    practicedDaysLast30: 12,
  },
  saved: { total: 42, due: 6, dueTomorrow: 2 },
  weakSpot: { part: 'impact', missing: 4, of: 6 },
  structure: {
    trend: [48, 52, 50, 61, 58, 66, 71, 74],
    parts: { claim: 92, warrant: 71, responding: 64, impact: 38 },
  },
  ruleSets: [
    {
      id: 'longer-speeches',
      name: 'Longer speeches',
      rules: { speechMinutes: 7, prepMinutes: 4, seats: 'both' },
    },
    {
      id: 'solo-one-side',
      name: 'Solo, one side',
      rules: { speechMinutes: 5, prepMinutes: 4, seats: 'solo' },
    },
  ],
};
