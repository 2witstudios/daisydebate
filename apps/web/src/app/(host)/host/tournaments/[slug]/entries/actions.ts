'use server';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import {
  judgeObligationEnvelope,
  judgeObligationAnswer,
  judgeObligationRefused,
  judgeObligationUnacknowledged,
  type JudgeObligationContext,
  type JudgeObligationState,
} from '../../../../../../features/tab/judge-obligation-form';
import { hostRoutes } from '../../../../../../features/tab/routes';
import { inProcessFetch } from '../../../../../../server/in-process-fetch';
import { moveOn } from '../../../../../../server/form-action';
import { POST } from '../../../../../api/tab/settings-command/route';

export async function judgeObligationAction(
  context: JudgeObligationContext,
  _previous: JudgeObligationState,
  form: FormData,
): Promise<JudgeObligationState> {
  let envelope;
  try {
    envelope = judgeObligationEnvelope(context, form);
  } catch {
    return judgeObligationRefused(
      form,
      'Enter whole numbers: at least one entry per group and zero or more judges.',
    );
  }
  const incoming = new Headers(await headers());
  let state;
  try {
    const response = await inProcessFetch(POST, incoming)(
      '/api/tab/settings-command',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(envelope),
      },
    );
    if (!response.ok)
      return response.status >= 500
        ? judgeObligationUnacknowledged(form)
        : judgeObligationRefused(
            form,
            'You cannot change judge obligations. Reload this page.',
          );
    state = judgeObligationAnswer(form, await response.json());
  } catch {
    return judgeObligationUnacknowledged(form);
  }
  if (state.kind !== 'accepted') return state;
  const path = `${hostRoutes.entries(context.handle)}?event=${context.eventId}`;
  revalidatePath(hostRoutes.entries(context.handle));
  return moveOn(incoming, path);
}
