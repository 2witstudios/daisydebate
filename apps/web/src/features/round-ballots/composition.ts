import { captureRule, readRoundOpening, roundWaitingOn } from '@daisy/debate-engine';
import { composeRoundMemberDependencies } from '../round-runtime/member-composition';
import type { App } from '../../server/app';
import { canReadRound, canReadTranscript } from '../round-runtime/reads';
import { createRoundBallotOperations } from './operations';
import { createRoundBallotHandlers } from './handlers';
export function composeRoundBallotRoutes(app: App) {
  return createRoundBallotHandlers({
    ...composeRoundMemberDependencies(app),
    clock: app.clock,
    operations: createRoundBallotOperations({
      store: app.database,
      nextBallotId: () => app.ids.next(),
      nextSegmentId: () => app.ids.next(),
    }),
    read: (caller, roundId) =>
      app.database.readRoundBallot({
        decideWaitingOn: roundWaitingOn,
        caller,
        roundId,
        captureRule,
        authorize: (round, account) => canReadRound(caller, round, account),
        authorizeTranscript: (round, account) =>
          canReadTranscript(caller, round, account),
        readOpening: readRoundOpening,
      }),
    assignments: (caller) => app.database.listRoundJudgeAssignments(caller),
  });
}
