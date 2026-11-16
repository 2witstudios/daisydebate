import { eventBallotAccess } from './audience';
import { readRoundOpening } from '@daisy/debate-engine';
import { composeRoundMemberDependencies } from '../round-runtime/member-composition';
import type { App } from '../../server/app';
import { canReadRound } from '../round-runtime/reads';
import { roundBallotReader } from './reader';
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
    read: roundBallotReader(app.database),
    assignments: (caller) =>
      app.database.listRoundJudgeAssignments({
        caller,
        readOpening: readRoundOpening,
        authorize: (round, account, owner) =>
          canReadRound(caller, round, account, owner),
        readEventDecision: (owner) =>
          eventBallotAccess(caller, owner).parts.includes('decision'),
      }),
  });
}
