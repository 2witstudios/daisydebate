import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  roundAnalysisLimits,
  roundAnalysisReportSchema,
  roundAnalysisViewSchema,
} from './round-analysis';
import { sampleRoundAnalysisReport as report } from './round-analysis.test-support';
import { roundBallotReadSchema } from './round-ballot-read';

setupRitewayBun();

test('a round analysis report has its own shape and limits', () => {
  const parses = (value: unknown) =>
    roundAnalysisReportSchema.safeParse(value).success;
  assert({
    given: 'a report within its limits',
    should: 'parse',
    actual: parses(report),
    expected: true,
  });
  assert({
    given: 'more improvements than the report allows',
    should: 'refuse it',
    actual: parses({
      ...report,
      improvements: Array.from(
        { length: roundAnalysisLimits.improvements + 1 },
        () => 'Extend.',
      ),
    }),
    expected: false,
  });
  assert({
    given: 'a skill scored outside 1 to 5',
    should: 'refuse it',
    actual: parses({
      ...report,
      skills: { ...report.skills, weighing: { score: 6, note: 'x' } },
    }),
    expected: false,
  });
  assert({
    given: 'a ballot rubric field such as a winner',
    should: 'refuse it: an analysis decides nothing',
    actual: parses({ ...report, winner: 'affirmative' }),
    expected: false,
  });
});

test('the round analysis view carries content only when ready', () => {
  assert({
    given: 'a locked view with report content',
    should: 'refuse it: locked carries nothing',
    actual: roundAnalysisViewSchema.safeParse({ status: 'locked', report })
      .success,
    expected: false,
  });
  assert({
    given: 'each state',
    should: 'parse',
    actual: [
      { status: 'ready', report },
      { status: 'pending' },
      { status: 'unavailable' },
      { status: 'locked' },
    ].map((view) => roundAnalysisViewSchema.safeParse(view).success),
    expected: [true, true, true, true],
  });
});

test('the ballot read carries no round analysis', () => {
  const read = {
    round: undefined,
    own: null,
    freeze: null,
    ballots: [],
    transcript: null,
  };
  const keys = Object.keys(roundBallotReadSchema.shape);
  assert({
    given: 'the ballot read contract',
    should: 'have no coaching or analysis field',
    actual: ['coaching', 'analysis', 'roundAnalysis'].filter((key) =>
      keys.includes(key),
    ),
    expected: [],
  });
  assert({
    given: 'a ballot read that adds an analysis key',
    should: 'refuse the key as unknown',
    actual: roundBallotReadSchema
      .safeParse({ ...read, analysis: { status: 'pending' } })
      .error?.issues.some((issue) => issue.code === 'unrecognized_keys'),
    expected: true,
  });
});
