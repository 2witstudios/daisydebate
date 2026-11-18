'use server';
import { headers } from 'next/headers';
import {
  createTournamentAnswer,
  createTournamentRefused,
  createTournamentUnacknowledged,
  runCreateTournament,
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
  const incoming = new Headers(await headers());
  const post = (route: typeof POST, path: string) => async (body: unknown) => {
    const response = await inProcessFetch(route, incoming)(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok)
      return response.status >= 500
        ? createTournamentUnacknowledged(form)
        : createTournamentRefused(
            form,
            'You cannot make a tournament from this account.',
          );
    return createTournamentAnswer(form, await response.json());
  };
  const result = await runCreateTournament(
    {
      lobbyCommand: post(POST, '/api/tab/lobby-command'),
      settingCommand: post(settingsPOST, '/api/tab/settings-command'),
    },
    context,
    form,
  );
  return result.kind === 'made'
    ? moveOn(incoming, hostRoutes.setup(result.handle))
    : result;
}
