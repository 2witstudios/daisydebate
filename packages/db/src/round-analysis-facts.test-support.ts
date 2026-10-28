import type { RoundAnalysisFacts } from './round-analysis-facts';

/** The facts row as the driver returns it, and the plain facts it becomes. */
export const factsRow = {
  status: 'completed',
  completed_at: new Date('2026-10-26T12:00:00.000Z'),
  frozen: true,
  lines: '2',
  analysis: {
    status: 'leased',
    attempts: 1,
    leaseExpiresAt: '2026-10-26T12:02:00+00:00',
    report: null,
  },
};
export const plainFacts: RoundAnalysisFacts = {
  status: 'completed',
  completedAt: '2026-10-26T12:00:00.000Z',
  frozen: true,
  lines: 2,
  analysis: {
    status: 'leased',
    attempts: 1,
    leaseExpiresAt: '2026-10-26T12:02:00.000Z',
    report: null,
  },
};
