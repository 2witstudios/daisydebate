import { composeRoundMemberDependencies } from '../round-runtime/member-composition';
import type { App } from '../../server/app';
import { canReadRound } from '../round-runtime/reads';
import { createRoundBallotOperations } from './operations';
import { createRoundBallotHandlers } from './handlers';
import { coachingView } from '../round-coaching/policy';
export function composeRoundBallotRoutes(app: App) {
  return createRoundBallotHandlers({
    ...composeRoundMemberDependencies(app),
    operations: createRoundBallotOperations({
      store: app.database,
      nextBallotId: () => app.ids.next(),
      nextSegmentId: () => app.ids.next(),
    }),
    read: async (caller, roundId) => {
      const { read, coaching } = await app.database.readRoundBallot({
        caller,
        roundId,
        authorize: (round, account) => canReadRound(caller, round, account),
      });
      return {
        ...read,
        coaching: coaching
          ? coachingView({
              ...coaching,
              now: app.clock.now(),
              // Coaching runs with the round workers (ADR 0071).
              enabled: app.config.ROUND_BOT_WORKER_POLICY !== undefined,
            })
          : null,
      };
    },
    assignments: (caller) => app.database.listRoundJudgeAssignments(caller),
  });
}
