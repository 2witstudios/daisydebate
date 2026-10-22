import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { deriveRoundOutcome } from './round-outcome';
setupRitewayBun();
const seats = ['judge-a', 'judge-b', 'judge-c'].map((id) => ({
  id,
  role: 'judge' as const,
}));
const submitted = (
  judgeParticipantId: string,
  winner: 'affirmative' | 'negative',
) => ({ judgeParticipantId, winner, status: 'submitted' as const });
test('all assigned ballots decide by majority independent of arrival order, with a tie as draw', () => {
  const ballots = [
    submitted('judge-a', 'affirmative'),
    submitted('judge-b', 'negative'),
    submitted('judge-c', 'affirmative'),
  ];
  assert({
    given: 'all three required judge seats and their ballots',
    should: 'return the same majority in either arrival order',
    actual: [
      deriveRoundOutcome(seats, ballots),
      deriveRoundOutcome(seats, [...ballots].reverse()),
      deriveRoundOutcome(seats.slice(0, 2), ballots.slice(0, 2)),
    ],
    expected: ['affirmative', 'affirmative', 'draw'],
  });
});
test('missing, voided, duplicate and foreign ballots cannot decide a Round', async () => {
  const a = submitted('judge-a', 'affirmative');
  for (const ballots of [
    [a],
    [
      a,
      { ...submitted('judge-b', 'negative'), status: 'voided' as const },
      submitted('judge-c', 'affirmative'),
    ],
    [a, a, submitted('judge-c', 'affirmative')],
    [a, submitted('judge-b', 'negative'), submitted('foreign', 'affirmative')],
  ])
    await assertRejects({
      given: JSON.stringify(ballots),
      should: 'refuse incomplete or inconsistent required judge evidence',
      actual: () => deriveRoundOutcome(seats, ballots),
      code: 'INVARIANT',
    });
  await assertRejects({
    given: 'no judge seats',
    should: 'refuse a result without an assigned judge',
    actual: () => deriveRoundOutcome([], []),
    code: 'INVARIANT',
  });
});
