import { assert, setupRitewayBun, test } from 'riteway/bun';
import { daisyWinnerBallot, freezeBallotJudging } from './ballot-definition';
import {
  fixtureRules,
  oneOnOneFormatFixture,
} from './format-fixtures.test-support';
setupRitewayBun();
const rules = fixtureRules(oneOnOneFormatFixture);
const ballot = {
  ...daisyWinnerBallot,
  key: 'custom-lattice',
  revision: 1,
  points: {
    ...daisyWinnerBallot.points!,
    scale: { min: 0.25, max: 1.25, step: 0.1 },
    default: 0.35,
    criteria: { kind: 'holistic' as const },
  },
};
const selection = {
  source: { kind: 'stored' as const, id: 's'.repeat(24), version: 1 },
  ballot,
};
test('a stored ballot freezes exact content and source under the original execution rules', () => {
  assert({
    given: 'an actual custom minimum/step and immutable stored source',
    should: 'retain that content and derive only its panel rule',
    actual: freezeBallotJudging(rules, selection),
    expected: {
      kind: 'frozen',
      judging: { ...selection, panel: { decision: 'majority', quorum: 1 } },
    },
  });
});
test('incompatible ballot definitions refuse before any execution write', () => {
  const invalid = [
    { ...selection, source: { ...selection.source, version: 2 } },
    {
      ...selection,
      ballot: {
        ...ballot,
        decision: {
          kind: 'ranking' as const,
          of: 'speakers' as const,
          ties: false,
        },
      },
    },
    {
      ...selection,
      ballot: { ...ballot, points: { ...ballot.points, default: 0.3 } },
    },
    {
      ...selection,
      ballot: {
        ...ballot,
        points: { ...ballot.points, per: 'speech' as const },
      },
    },
  ];
  assert({
    given:
      'a stale version, wrong decision target, off-lattice default or ambiguously shared scored segment',
    should: 'refuse rather than convert, round or substitute Daisy',
    actual: invalid.map((selection) => freezeBallotJudging(rules, selection)),
    expected: invalid.map(
      () =>
        ({
          kind: 'refused',
          refusal: 'ballot-definition-unavailable',
        }) as const,
    ),
  });
});
