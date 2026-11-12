import type { SQL } from 'bun';
import { testLane } from '../src/testing-lane';
import { createId } from '@paralleldrive/cuid2';
import { admitParticipants } from '../src/beta-access-testing';
import { drizzle } from 'drizzle-orm/bun-sql';
import { createMediaSessionStore } from '../src/media-session';
import { createBoundedTransaction } from '../src/bounded-transaction';
import type { LockedRoundTickInput } from '../src/round-clock-transaction';
import type { RoundLifecycle } from '@daisy/protocol';

/** The Round's own lifecycle columns, one status at a time so each keeps its instants. */
const lifecycleOf = (round: RoundLifecycle): RoundLifecycle => {
  switch (round.status) {
    case 'opening':
      return {
        status: round.status,
        startedAt: round.startedAt,
        completedAt: round.completedAt,
        outcome: round.outcome,
      };
    case 'active':
      return {
        status: round.status,
        startedAt: round.startedAt,
        completedAt: round.completedAt,
        outcome: round.outcome,
      };
    case 'completed':
      return {
        status: round.status,
        startedAt: round.startedAt,
        completedAt: round.completedAt,
        outcome: round.outcome,
      };
    case 'abandoned':
      return {
        status: round.status,
        startedAt: round.startedAt,
        completedAt: round.completedAt,
        outcome: round.outcome,
      };
  }
};

export const mediaTestTick: LockedRoundTickInput['buildProjection'] = ({
  round,
}) => ({
  round: {
    ...lifecycleOf(round),
    currentStage: round.currentStage,
    checkpoint: round.checkpoint,
  },
  segmentInserts: [],
  segmentCloses: [],
  effects: [],
});
export const mediaTestStore = (client: SQL) =>
  createMediaSessionStore({
    database: drizzle({ client }),
    run: createBoundedTransaction({
      lane: testLane(client, 10),
      now: performance.now,
    }),
    nextId: createId,
  });

export async function mediaTestHuman(
  fixture: Parameters<
    Parameters<typeof import('./constraint-helpers').withFixture>[1]
  >[0],
) {
  const roundId = await fixture.round();
  const seat = await fixture.seat(roundId, 'affirmative');
  await fixture.sql.unsafe(
    'update users set email_verified=true where id=(select user_id from actors where id=$1)',
    [seat.actorId],
  );
  // The seated human is an admitted participant (ADR 0075).
  const [owner] =
    await fixture.sql`select user_id from actors where id = ${seat.actorId}`;
  await admitParticipants(fixture.sql, [owner!.user_id as string]);
  return { roundId, seat };
}
