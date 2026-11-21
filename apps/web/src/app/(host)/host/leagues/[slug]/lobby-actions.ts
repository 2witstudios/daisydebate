'use server';
import { headers } from 'next/headers';
import {
  refused,
  unacknowledged,
} from '../../../../../features/forms/form-state';
import {
  standingLobbyAnswer,
  standingLobbyFormBody,
  standingLobbyRefusal,
  type StandingLobbyFormContext,
  type StandingLobbyFormState,
} from '../../../../../features/tab/standing-lobby-form';
import { hostRoutes } from '../../../../../features/tab/routes';
import { moveOn } from '../../../../../server/form-action';
import { runTabCommandForm } from '../../../../../features/tab/command-form-action';
import { requestNow } from '../../../../../lib/request-session';
import { POST } from '../../../../api/tab/lobby-command/route';

export async function submitStandingLobby(
  context: StandingLobbyFormContext,
  _previous: StandingLobbyFormState,
  form: FormData,
): Promise<StandingLobbyFormState> {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(context.slug))
    return refused(form, 'Reload the league and try again.');
  const body = standingLobbyFormBody(context, form, requestNow().slice(0, 10));
  if (!body.ok) return refused(form, body.error);

  const incoming = new Headers(await headers());
  const answer = await runTabCommandForm<
    ReturnType<typeof standingLobbyAnswer>
  >({
    post: POST,
    incoming,
    path: '/api/tab/lobby-command',
    body: body.value,
    answer: (response) => standingLobbyAnswer(form, response),
    refused: () => refused(form, standingLobbyRefusal('denied')),
    unacknowledged: () => unacknowledged(form),
  });
  if (answer.kind !== 'accepted') return answer;

  const lobby =
    context.kind === 'new-lobby'
      ? answer.receipt.aggregate.id
      : context.lobbyId;
  return moveOn(incoming, hostRoutes.standingLobbies(context.slug, { lobby }));
}
