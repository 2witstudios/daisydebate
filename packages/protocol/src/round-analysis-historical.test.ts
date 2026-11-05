import { assert, setupRitewayBun, test } from 'riteway/bun';
import { sampleRoundAnalysisReport as report } from './round-analysis.test-support';
import type { AnalysisWork } from './round-analysis-work';
import {
  advanceAnalysisWork as advance,
  analysisUsageOutcome,
  remainingAnalysisCalls,
} from './round-analysis-lifecycle';
import {
  requestId,
  context,
  step,
  dispatch,
  lease,
  history,
} from './round-analysis-work.test-support';
setupRitewayBun();
test('historical possible calls consume only remaining seat budget without inventing opt-in or dispatch', () => {
  const old: AnalysisWork = { kind: 'unrequested', historical: history };
  const admitted = step(
    old,
    { kind: 'request', evidenceLines: 1, requestId },
    1,
  );
  const served = dispatch(
    step(admitted, { kind: 'claim', lease: lease(1) }, 1),
    1,
    1,
  );
  assert({
    given:
      'an automatic claim with aggregate tokens, one later real requested call, and already terminal historical seats',
    should:
      'preserve original observations, allow only one remaining call, and never reset terminal seats',
    actual: [
      remainingAnalysisCalls(old),
      admitted.historical,
      analysisUsageOutcome(old),
      remainingAnalysisCalls(served),
      ...[2, 3].map(
        (claimedAttempts) =>
          advance(
            { ...old, historical: { ...history, claimedAttempts } },
            { kind: 'request', evidenceLines: 1, requestId },
            context(1),
          ).kind,
      ),
      ...(
        [
          {
            kind: 'retained',
            historical: { ...history, completedAt: context(1).now },
            report,
          },
          {
            kind: 'retired',
            historical: {
              ...history,
              completedAt: context(1).now,
              model: 'erased',
            },
            reason: 'erased',
          },
        ] satisfies AnalysisWork[]
      ).map(
        (state) =>
          advance(
            state,
            { kind: 'request', evidenceLines: 1, requestId },
            context(1),
          ).kind,
      ),
    ],
    expected: [
      1,
      history,
      'unspent',
      0,
      'refuse',
      'refuse',
      'unchanged',
      'unchanged',
    ],
  });
});
