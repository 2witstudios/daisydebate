import { assertRejects } from '@daisy/errors/testing';
import type { RatingPlan } from '@daisy/protocol';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  assertRatedRoundIntegrity,
  projectionLockOrder,
  ratedResult,
  ratingChangeRows,
} from './rating-decisions';

setupRitewayBun();

const state = (rating: number) => ({
  rating,
  deviation: 200,
  volatility: 0.06,
});
const plan: RatingPlan = {
  ladder: 'standard',
  seasonId: 'season',
  occurredAt: '2026-10-22T12:00:00.000Z',
  calculationVersion: 'glicko2@1',
  changes: [
    {
      changeId: 'change-z',
      actorId: 'zed',
      before: state(1500),
      after: state(1520),
      expectedVersion: null,
    },
    {
      changeId: 'change-a',
      actorId: 'amy',
      before: state(1600),
      after: state(1580),
      expectedVersion: 3,
    },
  ],
} as unknown as RatingPlan;

test('only ranked Rounds pin a preset and ladder', async () => {
  assert({
    given: 'a ranked Round with both and a casual Round with neither',
    should: 'accept both as intact',
    actual: [
      assertRatedRoundIntegrity({
        competitionType: 'ranked',
        presetVersion: 1,
        ladderId: 'ladder',
      }),
      assertRatedRoundIntegrity({
        competitionType: 'casual',
        presetVersion: null,
        ladderId: null,
      }),
    ],
    expected: [undefined, undefined],
  });
  for (const round of [
    { competitionType: 'ranked', presetVersion: null, ladderId: 'ladder' },
    { competitionType: 'ranked', presetVersion: 1, ladderId: null },
    { competitionType: 'casual', presetVersion: 1, ladderId: null },
    { competitionType: 'casual', presetVersion: null, ladderId: 'ladder' },
  ])
    await assertRejects({
      given: `a ${round.competitionType} Round with preset ${round.presetVersion} and ladder ${round.ladderId}`,
      should: 'report corrupted rating provenance as an invariant',
      actual: () => assertRatedRoundIntegrity(round),
      code: 'INVARIANT',
      invariantId: 'round.rating.integrity',
    });
});

test('one plan becomes paired ledger rows and a rated result', () => {
  const rows = ratingChangeRows(plan, { roundId: 'round', formatId: 'format' });
  assert({
    given: 'a two-debater plan',
    should:
      'write before and after state on each ledger row and return the same changes',
    actual: {
      rows: rows.map((row) => [
        row.id,
        row.actorId,
        row.roundId,
        row.formatId,
        row.seasonId,
        row.ladder,
        row.ratingBefore,
        row.ratingAfter,
        row.calculationVersion,
        row.occurredAt.toISOString(),
      ]),
      result: ratedResult(plan),
    },
    expected: {
      rows: [
        [
          'change-z',
          'zed',
          'round',
          'format',
          'season',
          'standard',
          1500,
          1520,
          'glicko2@1',
          '2026-10-22T12:00:00.000Z',
        ],
        [
          'change-a',
          'amy',
          'round',
          'format',
          'season',
          'standard',
          1600,
          1580,
          'glicko2@1',
          '2026-10-22T12:00:00.000Z',
        ],
      ],
      result: {
        kind: 'rated',
        ladder: 'standard',
        seasonId: 'season',
        changes: [
          {
            id: 'change-z',
            actorId: 'zed',
            before: state(1500),
            after: state(1520),
          },
          {
            id: 'change-a',
            actorId: 'amy',
            before: state(1600),
            after: state(1580),
          },
        ],
      },
    },
  });
});

test('projections lock in actor order whichever side each actor took', () => {
  assert({
    given: 'the same pair planned in both side orders',
    should: 'lock the same actor first both times without mutating the plan',
    actual: [
      projectionLockOrder(plan.changes).map(({ actorId }) => actorId),
      projectionLockOrder([...plan.changes].reverse()).map(
        ({ actorId }) => actorId,
      ),
      plan.changes.map(({ actorId }) => actorId),
    ],
    expected: [
      ['amy', 'zed'],
      ['amy', 'zed'],
      ['zed', 'amy'],
    ],
  });
});
