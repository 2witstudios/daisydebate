'use server';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import {
  peopleCommandEnvelope,
  peopleCommandValues,
  peopleCommandRefused,
  peopleCommandUnacknowledged,
  peopleCommandAnswered,
  type PeopleCommandContext,
  type PeopleCommandState,
} from '../../../../../../features/tab/organization-people-forms';
import { hostRoutes } from '../../../../../../features/tab/routes';
import { runTabCommandForm } from '../../../../../../features/tab/command-form-action';
import { POST } from '../../../../../api/tab/organization-command/route';

/** The existing people controls call exactly the route a script calls, using this request's session. */
export async function peopleCommandAction(
  context: PeopleCommandContext,
  _previous: PeopleCommandState,
  form: FormData,
): Promise<PeopleCommandState> {
  const values = peopleCommandValues(form);
  let envelope;
  try {
    envelope = peopleCommandEnvelope(context, form);
  } catch {
    return peopleCommandRefused(
      values,
      'Choose a person, a preset role and a valid expiry.',
    );
  }
  try {
    const state = await runTabCommandForm({
      post: POST,
      incoming: new Headers(await headers()),
      path: '/api/tab/organization-command',
      body: envelope,
      answer: (response) => peopleCommandAnswered(context, values, response),
      refused: (status) =>
        peopleCommandRefused(
          values,
          status === 400
            ? 'These details could not be used. Check them and try again.'
            : 'You cannot change these people. Reload this page.',
        ),
      unacknowledged: () => peopleCommandUnacknowledged(values),
    });
    if (state.kind === 'changed')
      revalidatePath(hostRoutes.leaguePeople(context.handle));
    return state;
  } catch {
    return peopleCommandUnacknowledged(values);
  }
}
