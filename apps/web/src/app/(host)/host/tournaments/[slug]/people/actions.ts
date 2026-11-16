'use server';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import {
  lobbyPeopleCommandValues,
  lobbyPeopleCommandIntent,
  lobbyPeopleCommandEnvelope,
  lobbyPeopleCommandRefused,
  lobbyPeopleCommandUnacknowledged,
  lobbyPeopleCommandAnswered,
  type LobbyPeopleCommandContext,
  type LobbyPeopleCommandState,
} from '../../../../../../features/tab/lobby-people-forms';
import { requestLobbyGrantTarget } from '../../../../../../lib/request-session';
import { hostRoutes } from '../../../../../../features/tab/routes';
import { inProcessFetch } from '../../../../../../server/in-process-fetch';
import { POST } from '../../../../../api/tab/organization-command/route';

/** Resolve a named recipient only through the shared discovery edge, then use the existing scoped grant command. */
export async function lobbyPeopleCommandAction(
  context: LobbyPeopleCommandContext,
  _previous: LobbyPeopleCommandState,
  form: FormData,
): Promise<LobbyPeopleCommandState> {
  const values = lobbyPeopleCommandValues(form);
  let intent;
  try {
    intent = lobbyPeopleCommandIntent(context, form);
  } catch {
    return lobbyPeopleCommandRefused(
      values,
      'Choose a username, an available role and a valid expiry.',
    );
  }
  try {
    const userId =
      intent.kind === 'give'
        ? await requestLobbyGrantTarget({
            lobbyId: context.lobbyId,
            username: intent.username,
          })
        : null;
    if (intent.kind === 'give' && userId === null)
      return lobbyPeopleCommandRefused(
        values,
        'That account or this People snapshot is no longer available. Check the username or reload this page.',
      );
    const envelope = lobbyPeopleCommandEnvelope(
      context,
      intent,
      userId === null ? {} : { userId },
    );
    const response = await inProcessFetch(POST, new Headers(await headers()))(
      '/api/tab/organization-command',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(envelope),
      },
    );
    if (!response.ok)
      return response.status >= 500
        ? lobbyPeopleCommandUnacknowledged(values)
        : lobbyPeopleCommandRefused(
            values,
            'You cannot change these people. Reload this page.',
          );
    const state = lobbyPeopleCommandAnswered(
      context.intent,
      values,
      await response.json(),
    );
    if (state.kind === 'changed')
      revalidatePath(hostRoutes.people(context.handle));
    return state;
  } catch {
    return lobbyPeopleCommandUnacknowledged(values);
  }
}
