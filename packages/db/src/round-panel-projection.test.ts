import { assertRejects } from '@daisy/errors/testing';
import {
  winnerOutcome,
  type RoundOutcome,
} from '@daisy/protocol/round-outcome';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireCompletionProjection } from './round-panel-decisions';

setupRitewayBun();

test('the completion must finish the Round, name a winner exactly when partly judged, and change no segment', async () => {
  type Projection = Parameters<
    typeof requireCompletionProjection
  >[0]['projection'];
  const completed = (outcome: RoundOutcome | null): Projection => ({
    round: { status: 'completed', outcome },
    segmentInserts: [],
    segmentCloses: [],
  });
  const completion = (
    ruling: 'unjudged' | 'judges-did-not-rule' | 'partial',
    projection: Projection,
  ) => ({ ruling, projection });
  for (const [label, candidate] of [
    [
      'an active Round',
      completion('unjudged', {
        ...completed(null),
        round: { status: 'active', outcome: null },
      }),
    ],
    [
      'no Round change',
      completion('unjudged', {
        ...completed(null),
        round: undefined,
      }),
    ],
    [
      'an unjudged winner',
      completion('unjudged', completed(winnerOutcome('negative'))),
    ],
    [
      'a partial ruling without a winner',
      completion('partial', completed(null)),
    ],
    [
      'a segment insert',
      completion('unjudged', {
        ...completed(null),
        segmentInserts: [{}],
      }),
    ],
    [
      'a segment close',
      completion('judges-did-not-rule', {
        ...completed(null),
        segmentCloses: [{}],
      }),
    ],
  ] as const)
    await assertRejects({
      given: `a completion with ${label}`,
      should: 'refuse it as an invalid projection',
      actual: () => requireCompletionProjection(candidate),
      code: 'CONFLICT',
    });
  assert({
    given:
      'winnerless unjudged and judges-did-not-rule completions, and a partial one with its winner',
    should: 'admit each',
    actual: [
      requireCompletionProjection(completion('unjudged', completed(null))),
      requireCompletionProjection(
        completion('judges-did-not-rule', completed(null)),
      ),
      requireCompletionProjection(
        completion('partial', completed(winnerOutcome('affirmative'))),
      ),
    ],
    expected: [undefined, undefined, undefined],
  });
});
