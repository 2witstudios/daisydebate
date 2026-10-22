'use server';
import { headers } from 'next/headers';
import { readRoundBallot } from '../../../../../features/round-ballots/reads';
import {
  submitRoundBallotForm,
  type RoundBallotFormState,
} from '../../../../../features/round-ballots/form';
import { hydratedPost, moveOn } from '../../../../../server/form-action';
import { inProcessFetch } from '../../../../../server/in-process-fetch';
import { processRoute } from '../../../../../server/process-app';
const read = processRoute(
  (routes) => (request) =>
    routes.rounds.getBallots(
      request,
      new URL(request.url).pathname.split('/')[3] ?? '',
    ),
);
const post = processRoute(
  (routes) => (request) =>
    routes.rounds.submitBallot(
      request,
      new URL(request.url).pathname.split('/')[3] ?? '',
    ),
);
export async function readPersistedBallot(roundId: string) {
  return readRoundBallot(
    inProcessFetch(read, new Headers(await headers())),
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
  const answer = await submitRoundBallotForm(
    inProcessFetch(post, incoming),
    roundId,
    form,
  );
  if (answer.receipt && !hydratedPost(incoming))
    return {
      ...answer,
      ...moveOn(incoming, `/judge/ballot/${answer.receipt.roundId}`),
    };
  return answer;
}
