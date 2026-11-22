'use server';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import {
  sanctionFormBody,
  sanctionFormAnswer,
  sanctionFormUnavailable,
  type SanctionFormContext,
  type SanctionFormState,
} from '../../../../../features/tab/sanction-form';
import { refused } from '../../../../../features/forms/form-state';
import { hostRoutes } from '../../../../../features/tab/routes';
import { runTabCommandForm } from '../../../../../features/tab/command-form-action';
import { POST } from '../../../../api/tab/sanction-command/route';
export async function sanctionDecisionAction(
  context: SanctionFormContext,
  _previous: SanctionFormState,
  form: FormData,
): Promise<SanctionFormState> {
  let body;
  try {
    body = sanctionFormBody(context);
  } catch {
    return refused(form, 'This request is unavailable. Reload the page.');
  }
  let state: SanctionFormState;
  try {
    state = await runTabCommandForm({
      post: POST,
      incoming: new Headers(await headers()),
      path: '/api/tab/sanction-command',
      body,
      answer: (response) => sanctionFormAnswer(form, response),
      refused: () =>
        refused(form, 'You cannot decide this request. Reload the page.'),
      unacknowledged: () => sanctionFormUnavailable(form),
    });
  } catch {
    return sanctionFormUnavailable(form);
  }
  if (state.kind === 'done') revalidatePath(hostRoutes.league(context.handle));
  return state;
}
