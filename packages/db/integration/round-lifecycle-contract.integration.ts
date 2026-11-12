import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import {
  isRoundLifecycle,
  roundStatuses,
  type RoundOutcome,
} from '@daisy/protocol';
import { rejected, withFixture } from './constraint-helpers';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

const started = '2026-01-01T00:00:00.000Z';
const ended = '2026-01-01T00:30:00.000Z';
const outcomes: readonly (RoundOutcome | null)[] = [null, 'affirmative'];

/** Every way the four lifecycle columns can be filled. */
const combinations = roundStatuses.flatMap((status) =>
  [null, started].flatMap((startedAt) =>
    [null, ended].flatMap((completedAt) =>
      outcomes.map((outcome) => ({ status, startedAt, completedAt, outcome })),
    ),
  ),
);
const named = (round: (typeof combinations)[number]) =>
  [
    round.status,
    round.startedAt === null ? '-' : 'started',
    round.completedAt === null ? '-' : 'ended',
    round.outcome ?? '-',
  ].join('/');

test('every Round row the database can hold is a lifecycle the contract holds', async () => {
  await withFixture(url, async (fixture) => {
    const stored: string[] = [];
    for (const round of combinations) {
      // An active Round stores its stage and every other status stores none,
      // so each combination is tried with the stage its status needs.
      const refused = await rejected(() =>
        fixture.round({
          status: round.status,
          current_stage: round.status === 'active' ? 'countdown' : null,
          started_at: round.startedAt,
          completed_at: round.completedAt,
          outcome: round.outcome,
        }),
      );
      if (!refused) stored.push(named(round));
    }
    assert({
      given:
        'every combination of status, start, end and outcome, written to rounds',
      should:
        'store exactly the ones the lifecycle contract holds, so no stored row can fail the refine',
      actual: stored,
      expected: combinations.filter(isRoundLifecycle).map(named),
    });
  });
});
