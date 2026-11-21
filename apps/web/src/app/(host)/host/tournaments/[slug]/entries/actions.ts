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
import { runTabCommandForm } from '../../../../../../features/tab/command-form-action';
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
  const state = await runTabCommandForm({
    post: POST,
    incoming,
    path: '/api/tab/settings-command',
    body: envelope,
    answer: (response) => judgeObligationAnswer(form, response),
    refused: () =>
      judgeObligationRefused(
        form,
        'You cannot change judge obligations. Reload this page.',
      ),
    unacknowledged: () => judgeObligationUnacknowledged(form),
  });
  if (state.kind !== 'accepted') return state;
  const path = `${hostRoutes.entries(context.handle)}?event=${context.eventId}`;
  revalidatePath(hostRoutes.entries(context.handle));
  return moveOn(incoming, path);
}
