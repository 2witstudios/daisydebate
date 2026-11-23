'use server';
import { headers } from 'next/headers';
import { ballotPlanOf } from '../../../../../features/round-ballots/presentation';
import { readRoundBallot } from '../../../../../features/round-ballots/reads';
import {
  ballotUnavailable,
  submitRoundBallotForm,
  type RoundBallotFormState,
} from '../../../../../features/round-ballots/form';
import { hydratedPost, moveOn } from '../../../../../server/form-action';
import { inProcessFetch } from '../../../../../server/in-process-fetch';
import { processRoute } from '../../../../../server/process-app';
import { roundBallotComposition } from '../../../../../features/round-ballots/composition';
const read = (roundId: string) =>
  processRoute(
    roundBallotComposition,
    (routes) => (request) => routes.getBallots(request, roundId),
  );
const post = (roundId: string) =>
  processRoute(
    roundBallotComposition,
    (routes) => (request) => routes.submitBallot(request, roundId),
  );
export async function readPersistedBallot(roundId: string) {
  return readRoundBallot(
    inProcessFetch(read(roundId), new Headers(await headers())),
    roundId,
  );
}
/** Native and enhanced ballots carry the original session/Origin through the exact API gates. */
export async function submitBallotAction(
  roundId: string,
  _state: RoundBallotFormState,
  form: FormData,
): Promise<RoundBallotFormState> {
  const incoming = new Headers(await headers());
  const current = await readPersistedBallot(roundId);
  // The ballot is read against its Round's own plan; with no Round read, it
  // is kept for a retry, as any unacknowledged ballot is.
  if (current.kind !== 'found') return ballotUnavailable(form);
  const answer = await submitRoundBallotForm(
    inProcessFetch(post(roundId), incoming),
    roundId,
    form,
    ballotPlanOf(current.view),
  );
  if (answer.kind === 'recorded' && !hydratedPost(incoming))
    return moveOn(incoming, `/judge/ballot/${answer.receipt.roundId}`);
  return answer;
}

/** Every judge live refresh rechecks the actual own assignment, even before freeze. */
export async function readPersistedJudgeRound(roundId: string) {
  const result = await readPersistedBallot(roundId);
  if (result.kind !== 'found') return result;
  return result.view.own
    ? { kind: 'found' as const, round: result.view.round }
    : { kind: 'missing' as const };
}
