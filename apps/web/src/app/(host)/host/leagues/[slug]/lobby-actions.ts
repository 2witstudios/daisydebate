'use server';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import {
  moved,
  refused,
  unacknowledged,
} from '../../../../../features/forms/form-state';
import {
  standingLobbyAnswerSchema,
  standingLobbyFormBody,
  standingLobbyRefusal,
  type StandingLobbyFormContext,
  type StandingLobbyFormState,
} from '../../../../../features/tab/standing-lobby-form';
import { hostRoutes } from '../../../../../features/tab/routes';
import { inProcessFetch } from '../../../../../server/in-process-fetch';
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

  let data;
  try {
    const response = await inProcessFetch(POST, new Headers(await headers()))(
      '/api/tab/lobby-command',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body.value),
      },
    );
    if (!response.ok)
      return response.status >= 500
        ? unacknowledged(form)
        : refused(form, standingLobbyRefusal('denied'));
    const answer = standingLobbyAnswerSchema.safeParse(await response.json());
    if (!answer.success) return unacknowledged(form);
    if (answer.data.kind === 'refused')
      return refused(form, standingLobbyRefusal(answer.data.refusal));
    data = answer.data.receipt;
  } catch {
    return unacknowledged(form);
  }

  const lobby =
    context.kind === 'new-lobby' ? data.aggregate.id : context.lobbyId;
  revalidatePath(hostRoutes.league(context.slug));
  return moved(hostRoutes.standingLobbies(context.slug, { lobby }));
}
