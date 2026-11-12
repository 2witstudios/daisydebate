import { assert, setupRitewayBun, test } from 'riteway/bun';
import { passesReport, type PassRow } from './passes';
setupRitewayBun();

const scores = (thesis: number, burdens: number) => ({
  affirmative: { thesis, burdens },
  negative: { thesis: 3, burdens: 3 },
});
const rows: PassRow[] = [
  {
    roundId: 'r1',
    resolution: 'Space was worth it.',
    first: { winner: 'negative', scores: scores(3, 3) },
    firstFailed: false,
    final: { winner: 'affirmative', scores: scores(4, 5) },
  },
  {
    roundId: 'r2',
    resolution: null,
    first: { winner: 'affirmative', scores: scores(4, 4) },
    firstFailed: false,
    final: { winner: 'affirmative', scores: scores(4, 4) },
  },
  {
    roundId: 'r3',
    resolution: null,
    first: null,
    firstFailed: true,
    final: { winner: 'negative', scores: scores(3, 3) },
  },
];

test('first pass against final', () => {
  const report = passesReport(rows);
  assert({
    given: 'a flipped Round, a kept Round and a Round whose first pass failed',
    should:
      'mark the flip, count agreement only where a first pass exists, and average each category’s shift over both sides',
    actual: [
      report.includes('- r1 Space was worth it.: NEG → AFF (flipped)'),
      report.includes('- r2: AFF → AFF\n'),
      report.includes('- r3: first pass failed, final NEG'),
      report.includes('Winner kept: 1/2.'),
      report.includes('thesis +0.25, burdens +0.5'),
    ],
    expected: [true, true, true, true, true],
  });
});
