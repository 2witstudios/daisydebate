import type { RoundAnalysisFacts } from '@daisy/db/rounds';
import { advanceAnalysisWork, type AnalysisWork } from '@daisy/protocol';
import { sampleRoundAnalysisReport as report } from '@daisy/protocol/round-analysis-testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { roundAnalysisView } from './policy';
setupRitewayBun();
const now = '2026-11-05T12:00:00.000Z';
const facts = (
  overrides: Partial<RoundAnalysisFacts> = {},
): RoundAnalysisFacts => ({
  status: 'completed',
  completedAt: '2025-01-01T00:00:00.000Z',
  frozen: true,
  lines: 4,
  analysis: null,
  ...overrides,
});
const view = (
  value: RoundAnalysisFacts,
  allowance: 'free' | 'included' | 'unavailable' = 'free',
  enabled = true,
) => roundAnalysisView({ facts: value, allowance, enabled, now });
const historical = {
  createdAt: '2025-01-01T00:00:00.000Z',
  completedAt: null,
  claimedAttempts: 1,
  model: 'historical',
  inputTokens: 0,
  outputTokens: 0,
};

test('analysis is requested only with actual evidence, without any Round-age window', () => {
  assert({
    given:
      'a historical completed Round with remaining frozen evidence and free or included allowance',
    should: 'offer an explicit request, never automatic pending work',
    actual: [view(facts()), view(facts(), 'included')],
    expected: [
      { status: 'requestable', allowance: 'free' },
      { status: 'requestable', allowance: 'included' },
    ],
  });
  assert({
    given:
      'missing freeze, no lines, active Round, no completion, missing worker, or exhausted allowance',
    should: 'refuse generation and distinguish an allowance upsell',
    actual: [
      view(facts({ frozen: false })),
      view(facts({ lines: 0 })),
      view(facts({ status: 'active' })),
      view(facts({ completedAt: null })),
      view(facts(), 'free', false),
      view(facts(), 'unavailable'),
    ].map((s) => s.status),
    expected: [
      'unavailable',
      'unavailable',
      'unavailable',
      'unavailable',
      'unavailable',
      'locked',
    ],
  });
});
test('retained content survives lapse while terminal and exhausted identities cannot reopen', () => {
  const retained: AnalysisWork = {
    kind: 'retained',
    historical: { ...historical, completedAt: '2025-01-01T00:01:00.000Z' },
    report,
  };
  assert({
    given:
      'an authorized delivered report with no paid access, worker or transcript remaining',
    should: 'return the stored report without generation',
    actual: view(
      facts({ analysis: retained, frozen: false, lines: 0 }),
      'unavailable',
      false,
    ),
    expected: { status: 'ready', report },
  });
  assert({
    given:
      'an erased terminal identity, retired old failure and an unrequested old job at its possible-call cap',
    should: 'keep every seat unavailable for new generation',
    actual: [
      { kind: 'retired', historical, reason: 'erased' },
      { kind: 'retired', historical, reason: 'failed' },
      {
        kind: 'unrequested',
        historical: { ...historical, claimedAttempts: 2 },
      },
    ].map(
      (analysis) => view(facts({ analysis: analysis as AnalysisWork })).status,
    ),
    expected: ['unavailable', 'unavailable', 'unavailable'],
  });
});
test('only admitted work is pending and its execution deadline never extends', () => {
  const decision = advanceAnalysisWork(
    null,
    { kind: 'request', requestId: 'r'.repeat(24), evidenceLines: 4 },
    { now, authorized: true, evidenceAvailable: true },
  );
  if (decision.kind !== 'changed') throw Error('Expected requested work');
  assert({
    given:
      'one admitted request before and exactly at its fifteen-minute deadline',
    should: 'be pending only while its bounded work can still finish',
    actual: [
      view(facts({ analysis: decision.state })).status,
      roundAnalysisView({
        facts: facts({ analysis: decision.state }),
        allowance: 'included',
        enabled: true,
        now: '2026-11-05T12:15:00.000Z',
      }).status,
    ],
    expected: ['pending', 'unavailable'],
  });
});
