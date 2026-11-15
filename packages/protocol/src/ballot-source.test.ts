import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  daisyWinnerBallot,
  panelRuleFor,
  roundJudgingSchema,
} from './ballot-definition';
setupRitewayBun();
test('frozen judging names its exact Daisy or stored source', () => {
  const ballot = daisyWinnerBallot;
  const panel = panelRuleFor(ballot);
  const source = { kind: 'daisy', key: ballot.key, revision: ballot.revision };
  assert({
    given:
      'exact Daisy content, a custom stored body, a mismatched source or an absent source',
    should: 'accept only explicit matching immutable provenance',
    actual: [
      roundJudgingSchema.safeParse({ ballot, panel, source }).success,
      roundJudgingSchema.safeParse({
        ballot: { ...ballot, key: 'custom', revision: 2 },
        panel,
        source: { kind: 'stored', id: 's'.repeat(24), version: 2 },
      }).success,
      roundJudgingSchema.safeParse({
        ballot: { ...ballot, key: 'custom' },
        panel,
        source,
      }).success,
      roundJudgingSchema.safeParse({
        ballot,
        panel,
        source: { ...source, revision: 1 },
      }).success,
      roundJudgingSchema.safeParse({ ballot, panel }).success,
    ],
    expected: [true, true, false, false, false],
  });
});
