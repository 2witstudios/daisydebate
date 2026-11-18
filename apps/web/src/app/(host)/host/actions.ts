'use server';
import { headers } from 'next/headers';
import {
  createTournamentAnswer,
  createTournamentEnvelope,
  createTournamentRefused,
  createTournamentUnacknowledged,
  divisionSettingEnvelope,
  freestyleEventEnvelope,
  type CreateTournamentContext,
  type CreateTournamentState,
} from '../../../features/hosting-purchases/create-tournament-form';
import { hostRoutes } from '../../../features/tab/routes';
import { inProcessFetch } from '../../../server/in-process-fetch';
import { moveOn } from '../../../server/form-action';
import { POST } from '../../api/tab/lobby-command/route';
import { POST as settingsPOST } from '../../api/tab/settings-command/route';

/** Free hosting (decision 80): any adult makes a tournament, with its Freestyle event. */
export async function createTournamentAction(
  context: CreateTournamentContext,
  _previous: CreateTournamentState,
  form: FormData,
): Promise<CreateTournamentState> {
  let made;
  try {
    made = createTournamentEnvelope(context, form);
  } catch {
    return createTournamentRefused(form, 'Reload this page and try again.');
  }
  if (made === null)
    return createTournamentRefused(form, 'Name the tournament.');
  const incoming = new Headers(await headers());
  const send = async (body: unknown) => {
    const response = await inProcessFetch(POST, incoming)(
      '/api/tab/lobby-command',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    if (!response.ok)
      return response.status >= 500
        ? createTournamentUnacknowledged(form)
        : createTournamentRefused(
            form,
            'You cannot make a tournament from this account.',
          );
    return createTournamentAnswer(form, await response.json());
  };
  try {
    const lobby = await send(made.envelope);
    if (lobby.kind !== 'accepted') return lobby;
    if (made.division === 'youth') {
      const division = await inProcessFetch(settingsPOST, incoming)(
        '/api/tab/settings-command',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(divisionSettingEnvelope(context, lobby.lobbyId)),
        },
      );
      // The tournament exists either way; Setup shows its division to change.
      void division;
    }
    const event = await send(
      freestyleEventEnvelope(context, lobby.lobbyId, lobby.version),
    );
    // The tournament exists either way; Setup lets the host add the event.
    void event;
  } catch {
    return createTournamentUnacknowledged(form);
  }
  return moveOn(incoming, hostRoutes.setup(made.handle));
}
