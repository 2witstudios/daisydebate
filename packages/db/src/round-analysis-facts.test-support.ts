import type { RoundAnalysisFacts } from './round-analysis-facts';
export const history = {
  createdAt: '2026-10-26T12:00:00.000Z',
  completedAt: null,
  claimedAttempts: 1,
  model: 'original',
  inputTokens: 0,
  outputTokens: 0,
};
export const factsRow = {
  status: 'completed',
  completed_at: new Date('2026-10-26T12:00:00.000Z'),
  frozen: true,
  lines: '2',
  analysis: { kind: 'unrequested', historical: history },
};
export const plainFacts: RoundAnalysisFacts = {
  status: 'completed',
  completedAt: '2026-10-26T12:00:00.000Z',
  frozen: true,
  lines: 2,
  analysis: { kind: 'unrequested', historical: history },
};
