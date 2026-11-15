import { eventBallotAccess } from './audience';
import {
  captureRule,
  readRoundOpening,
  roundWaitingOn,
} from '@daisy/debate-engine';
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
        ballotAccess: (_round, _account, owner) =>
          eventBallotAccess(caller, owner),
        decideWaitingOn: roundWaitingOn,
        caller,
        roundId,
        captureRule,
        authorize: (round, account, authority) =>
          canReadRound(caller, round, account, authority),
        authorizeTranscript: (round, account, authority) =>
          canReadTranscript(caller, round, account, authority),
        readOpening: readRoundOpening,
      }),
    assignments: (caller) => app.database.listRoundJudgeAssignments(caller),
  });
}
