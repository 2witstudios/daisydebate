import { assertRejects } from '@daisy/errors/testing';
import type { RoundProjection } from '@daisy/protocol';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireCompletionProjection } from './round-unjudged-decisions';

setupRitewayBun();

test('the completion must finish the Round, name a winner exactly when partly judged, and change no segment', async () => {
  const completed = (outcome: string | null) =>
    ({
      round: { status: 'completed', outcome },
      segmentInserts: [],
      segmentCloses: [],
    }) as unknown as RoundProjection;
  const completion = (
    ruling: 'unjudged' | 'judges-did-not-rule' | 'partial',
    projection: RoundProjection,
  ) => ({ ruling, projection });
  for (const [label, candidate] of [
    [
      'an active Round',
      completion('unjudged', {
        ...completed(null),
        round: { status: 'active' },
      } as unknown as RoundProjection),
    ],
    [
      'no Round change',
      completion('unjudged', {
        ...completed(null),
        round: undefined,
      } as unknown as RoundProjection),
    ],
    ['an unjudged winner', completion('unjudged', completed('negative'))],
    [
      'a partial ruling without a winner',
      completion('partial', completed(null)),
    ],
    [
      'a segment insert',
      completion('unjudged', {
        ...completed(null),
        segmentInserts: [{}],
      } as unknown as RoundProjection),
    ],
    [
      'a segment close',
      completion('judges-did-not-rule', {
        ...completed(null),
        segmentCloses: [{}],
      } as unknown as RoundProjection),
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
        completion('partial', completed('affirmative')),
      ),
    ],
    expected: [undefined, undefined, undefined],
  });
});
