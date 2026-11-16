import { daisyBallotSource } from '@daisy/protocol';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import {
  daisyBallotDefinitions,
  daisyWinnerBallot,
  judgeSeat,
  winnerOutcome,
} from '@daisy/protocol';
import { deriveRoundOutcome } from './round-outcome';
setupRitewayBun();
const judging = {
  source: daisyBallotSource(daisyWinnerBallot),
  ballot: daisyWinnerBallot,
  panel: { decision: 'majority', quorum: 1 },
} as const;
const seats = ['judge-a', 'judge-b', 'judge-c'].map((id, slot) => ({
  id,
  seat: judgeSeat(slot),
}));
const submitted = (
  judgeParticipantId: string,
  winner: 'affirmative' | 'negative' | null,
) => ({ judgeParticipantId, winner });
test('all assigned ballots decide by majority independent of arrival order, with a tie as no winner', () => {
  const ballots = [
    submitted('judge-a', 'affirmative'),
    submitted('judge-b', 'negative'),
    submitted('judge-c', 'affirmative'),
  ];
  assert({
    given: 'all three required judge seats and their ballots',
    should: 'return the same majority in either arrival order',
    actual: [
      deriveRoundOutcome(judging, seats, ballots),
      deriveRoundOutcome(judging, seats, [...ballots].reverse()),
      deriveRoundOutcome(judging, seats.slice(0, 2), ballots.slice(0, 2)),
    ],
    expected: [
      winnerOutcome('affirmative'),
      winnerOutcome('affirmative'),
      null,
    ],
  });
});
test('missing, duplicate and foreign ballots cannot decide a Round', async () => {
  const a = submitted('judge-a', 'affirmative');
  for (const ballots of [
    [a],
    [a, a, submitted('judge-c', 'affirmative')],
    [a, submitted('judge-b', 'negative'), submitted('foreign', 'affirmative')],
  ])
    await assertRejects({
      given: JSON.stringify(ballots),
      should: 'refuse incomplete or inconsistent required judge evidence',
      actual: () => deriveRoundOutcome(judging, seats, ballots),
      code: 'INVARIANT',
    });
  await assertRejects({
    given: 'no judge seats',
    should: 'refuse a result without an assigned judge',
    actual: () => deriveRoundOutcome(judging, [], []),
    code: 'INVARIANT',
  });
});
test('a ballot naming no side votes for nobody, so one side short of a strict majority has no winner', () => {
  assert({
    given: 'one ballot for each side and one naming no side',
    should: 'return no result',
    actual: deriveRoundOutcome(judging, seats, [
      submitted('judge-a', 'affirmative'),
      submitted('judge-b', 'negative'),
      submitted('judge-c', null),
    ]),
    expected: null,
  });
});
test("a rank-sum panel sums each subject's places, and equal sums share a place", () => {
  const ranked = (
    judgeParticipantId: string,
    ranking: readonly (readonly string[])[],
  ) => ({ judgeParticipantId, ranking });
  assert({
    given: 'three ranking ballots over four teams',
    should:
      'order the teams by their summed places, sharing a place on equal sums',
    actual: deriveRoundOutcome(
      {
        source: daisyBallotSource(daisyBallotDefinitions['rank-sides@1']),
        ballot: daisyBallotDefinitions['rank-sides@1'],
        panel: { decision: 'rank_sum', quorum: 1 },
      },
      seats,
      [
        ranked('judge-a', [['og'], ['oo'], ['cg'], ['co']]),
        ranked('judge-b', [['oo'], ['og'], ['co'], ['cg']]),
        ranked('judge-c', [['og'], ['oo'], ['co'], ['cg']]),
      ],
    ),
    expected: {
      kind: 'ranking',
      of: 'sides',
      places: [['og'], ['oo'], ['co'], ['cg']],
    },
  });
  assert({
    given: 'two ranking ballots that mirror each other',
    should: 'put both teams in one shared place',
    actual: deriveRoundOutcome(
      {
        source: daisyBallotSource(daisyBallotDefinitions['rank-sides@1']),
        ballot: daisyBallotDefinitions['rank-sides@1'],
        panel: { decision: 'rank_sum', quorum: 1 },
      },
      seats.slice(0, 2),
      [
        ranked('judge-a', [['og'], ['oo']]),
        ranked('judge-b', [['oo'], ['og']]),
      ],
    ),
    expected: { kind: 'ranking', of: 'sides', places: [['og', 'oo']] },
  });
});
