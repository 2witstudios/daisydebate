import { composeRoundMemberDependencies } from '../round-runtime/member-composition';
import type { App } from '../../server/app';
import { canReadRound } from '../round-runtime/reads';
import { createRoundBallotOperations } from './operations';
import { createRoundBallotHandlers } from './handlers';
export function composeRoundBallotRoutes(app: App) {
  return createRoundBallotHandlers({
    ...composeRoundMemberDependencies(app),
    operations: createRoundBallotOperations({
      store: app.database,
      nextBallotId: () => app.ids.next(),
      nextSegmentId: () => app.ids.next(),
    }),
    read: (caller, roundId) =>
      app.database.readRoundBallot({
        caller,
        roundId,
        authorize: (round, account) => canReadRound(caller, round, account),
        // Coaching runs with the round workers (ADR 0071).
        coachingEnabled: app.config.ROUND_BOT_WORKER_POLICY !== undefined,
      }),
    assignments: (caller) => app.database.listRoundJudgeAssignments(caller),
  });
}
