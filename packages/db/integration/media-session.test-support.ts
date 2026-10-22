import { createId } from '@paralleldrive/cuid2';
import { drizzle } from 'drizzle-orm/bun-sql';
import { createMediaSessionStore } from '../src/media-session';
import { createBoundedTransaction } from '../src/bounded-transaction';
import type { LockedRoundTickInput } from '../src/round-clock-transaction';

export const mediaTestTick: LockedRoundTickInput['buildProjection'] = ({
  round,
}) => ({
  round: {
    status: round.status,
    currentStage: round.currentStage,
    startedAt: round.startedAt,
    completedAt: round.completedAt,
    outcome: round.outcome,
    checkpoint: round.checkpoint,
  },
  segmentInserts: [],
  segmentCloses: [],
  effects: [],
});
export const mediaTestStore = (
  client: Parameters<typeof createBoundedTransaction>[0]['client'],
) =>
  createMediaSessionStore({
    database: drizzle({ client }),
    run: createBoundedTransaction({
      client,
      maxConnections: 10,
      now: performance.now,
    }),
    nextId: createId,
  });
