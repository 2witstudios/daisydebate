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
import { inProcessFetch } from '../../../../../server/in-process-fetch';
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
    const response = await inProcessFetch(POST, new Headers(await headers()))(
      '/api/tab/sanction-command',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    if (!response.ok)
      return response.status >= 500
        ? sanctionFormUnavailable(form)
        : refused(form, 'You cannot decide this request. Reload the page.');
    state = sanctionFormAnswer(form, await response.json());
  } catch {
    return sanctionFormUnavailable(form);
  }
  if (state.kind === 'done') revalidatePath(hostRoutes.league(context.handle));
  return state;
}
