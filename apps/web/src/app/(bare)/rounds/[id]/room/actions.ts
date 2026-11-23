'use server';
import { headers } from 'next/headers';
import {
  submitRoundForm,
  type RoundFormState,
} from '../../../../../features/round-runtime/command-form';
import { hydratedPost, moveOn } from '../../../../../server/form-action';
import { inProcessFetch } from '../../../../../server/in-process-fetch';
import { processRoute } from '../../../../../server/process-app';
import { roundComposition } from '../../../../../features/round-runtime/composition';
const commands = (roundId: string) =>
  processRoute(
    roundComposition,
    (routes) => (request) => routes.commands(request, roundId),
  );
async function submitRound(roundId: string, form: FormData) {
  const incoming = new Headers(await headers());
  const answer = await submitRoundForm(
    inProcessFetch(commands(roundId), incoming),
    roundId,
    form,
  );
  return { incoming, answer };
}
/** Native posts use the same Origin/session/member/rate/actor/engine gates as JSON. */
export async function roundCommandAction(
  roundId: string,
  _state: RoundFormState,
  form: FormData,
): Promise<RoundFormState> {
  const { incoming, answer } = await submitRound(roundId, form);
  if (answer.kind === 'acknowledged' && !hydratedPost(incoming))
    return moveOn(incoming, `/rounds/${roundId}/room`);
  return answer;
}

/**
 * Leaving a live Round forfeits it: the existing forfeit command ends the
 * Round, which frees its Room's members (ADR 0070), then the debater goes
 * to the Round's result, where a seat that no longer plays always lands.
 * A refused forfeit stays in the Round with its reason.
 */
export async function leaveRoundAction(
  roundId: string,
  _state: RoundFormState,
  form: FormData,
): Promise<RoundFormState> {
  const { incoming, answer } = await submitRound(roundId, form);
  if (answer.kind !== 'acknowledged') return answer;
  return moveOn(incoming, `/rounds/${roundId}`);
}
