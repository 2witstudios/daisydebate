import { type RoundBallotStore } from '@daisy/db/stores/rounds';
import {
  captureRule,
  readRoundOpening,
  roundWaitingOn,
} from '@daisy/debate-engine';
import { canReadRound, canReadTranscript } from '../round-runtime/reads';
import { eventBallotAccess } from './audience';

/** A ballot's own current permission grants its structured read, never Room/video access. */
export const roundBallotReader =
  (store: Pick<RoundBallotStore, 'readRoundBallot'>) =>
  (
    caller: { readonly userId: string; readonly actorId: string },
    roundId: string,
  ) =>
    store.readRoundBallot({
      caller,
      roundId,
      captureRule,
      readOpening: readRoundOpening,
      decideWaitingOn: roundWaitingOn,
      ballotAccess: (_round, _account, owner) =>
        eventBallotAccess(caller, owner),
      authorize: (round, account, owner) =>
        canReadRound(caller, round, account, owner) ||
        eventBallotAccess(caller, owner).parts.length > 0,
      authorizeTranscript: (round, account, owner) =>
        canReadTranscript(caller, round, account, owner),
    });
