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
import { runTabCommandForm } from '../../../../../../features/tab/command-form-action';
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
    const state = await runTabCommandForm({
      post: POST,
      incoming: new Headers(await headers()),
      path: '/api/tab/organization-command',
      body: envelope,
      answer: (response) =>
        lobbyPeopleCommandAnswered(context.intent, values, response),
      refused: () =>
        lobbyPeopleCommandRefused(
          values,
          'You cannot change these people. Reload this page.',
        ),
      unacknowledged: () => lobbyPeopleCommandUnacknowledged(values),
    });
    if (state.kind === 'changed')
      revalidatePath(hostRoutes.people(context.handle));
    return state;
  } catch {
    return lobbyPeopleCommandUnacknowledged(values);
  }
}
